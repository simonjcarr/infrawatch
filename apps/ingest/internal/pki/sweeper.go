package pki

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RunCSRSweeper consumes pending_cert_signings rows, signs each CSR with the
// current agent CA, writes the signed cert onto the agents row, and deletes
// the queue entry. Errors are recorded per-row so manual inspection is
// possible without blocking progress.
func RunCSRSweeper(ctx context.Context, pool *pgxpool.Pool, ca *AgentCA, interval time.Duration) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := drain(ctx, pool, ca); err != nil {
				slog.Warn("csr sweeper drain", "err", err)
			}
		}
	}
}

type pendingRow struct {
	ID      string
	AgentID string
	OrgID   string
	CsrDER  []byte
}

func drain(ctx context.Context, pool *pgxpool.Pool, ca *AgentCA) error {
	rows, err := pool.Query(ctx, `
		SELECT p.id, p.agent_id, a.organisation_id, p.csr_der
		  FROM pending_cert_signings p
		  JOIN agents a ON a.id = p.agent_id
		 ORDER BY p.requested_at ASC
		 LIMIT 50`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var pending []pendingRow
	for rows.Next() {
		var row pendingRow
		if err := rows.Scan(&row.ID, &row.AgentID, &row.OrgID, &row.CsrDER); err != nil {
			return err
		}
		pending = append(pending, row)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()

	for _, row := range pending {
		if err := signOne(ctx, pool, ca, row); err != nil {
			slog.Warn("signing pending CSR", "pending_id", row.ID, "agent_id", row.AgentID, "err", err)
			_, _ = pool.Exec(ctx, `
				UPDATE pending_cert_signings
				   SET last_error = $1, last_attempt_at = NOW()
				 WHERE id = $2`, err.Error(), row.ID)
			continue
		}
	}
	return nil
}

func signOne(ctx context.Context, pool *pgxpool.Pool, ca *AgentCA, row pendingRow) error {
	leaf, err := ca.Sign(row.CsrDER, row.AgentID, row.OrgID)
	if err != nil {
		return err
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE agents
		   SET client_cert_pem = $1,
		       client_cert_serial = $2,
		       client_cert_issued_at = NOW(),
		       client_cert_not_after = $3,
		       updated_at = NOW()
		 WHERE id = $4`,
		string(leaf.PEM), leaf.Serial, leaf.NotAfter, row.AgentID,
	); err != nil {
		return err
	}

	res, err := tx.Exec(ctx, `DELETE FROM pending_cert_signings WHERE id = $1`, row.ID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return errors.New("pending row vanished during signing")
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	slog.Info("signed agent client cert",
		"agent_id", row.AgentID,
		"org_id", row.OrgID,
		"serial", leaf.Serial,
		"not_after", leaf.NotAfter,
	)
	return nil
}
