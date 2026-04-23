package queries

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UpsertPendingCSR queues a fresh CSR for the given agent. If older rows
// exist for the same agent (e.g. from an earlier re-registration whose
// signing was never consumed) they are removed so only the newest CSR is
// considered. Idempotent.
func UpsertPendingCSR(ctx context.Context, pool *pgxpool.Pool, agentID string, csrDER []byte) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM pending_cert_signings WHERE agent_id = $1`, agentID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO pending_cert_signings (id, agent_id, csr_der, requested_at)
		VALUES (substr(md5(random()::text), 1, 24), $1, $2, NOW())`,
		agentID, csrDER,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
