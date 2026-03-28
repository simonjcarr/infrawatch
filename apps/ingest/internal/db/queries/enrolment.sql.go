package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EnrolmentToken represents a row from the agent_enrolment_tokens table.
type EnrolmentToken struct {
	ID           string
	OrganisationID string
	Label        string
	Token        string
	AutoApprove  bool
	MaxUses      *int
	UsageCount   int
	ExpiresAt    *time.Time
}

// GetEnrolmentToken looks up a valid (non-deleted, non-expired, not exhausted)
// enrolment token by its token value.
func GetEnrolmentToken(ctx context.Context, pool *pgxpool.Pool, token string) (*EnrolmentToken, error) {
	const q = `
		SELECT id, organisation_id, label, token, auto_approve, max_uses, usage_count, expires_at
		FROM agent_enrolment_tokens
		WHERE token = $1
		  AND deleted_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		  AND (max_uses IS NULL OR usage_count < max_uses)
	`
	row := pool.QueryRow(ctx, q, token)

	var t EnrolmentToken
	if err := row.Scan(
		&t.ID, &t.OrganisationID, &t.Label, &t.Token,
		&t.AutoApprove, &t.MaxUses, &t.UsageCount, &t.ExpiresAt,
	); err != nil {
		return nil, err
	}
	return &t, nil
}

// IncrementUsageCount atomically bumps the usage counter for an enrolment token.
func IncrementUsageCount(ctx context.Context, pool *pgxpool.Pool, tokenID string) error {
	const q = `UPDATE agent_enrolment_tokens SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1`
	_, err := pool.Exec(ctx, q, tokenID)
	return err
}
