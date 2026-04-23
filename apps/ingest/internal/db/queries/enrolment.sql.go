package queries

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TagPair is a single key=value tag, matching the TS TagPair shape.
type TagPair struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// EnrolmentTokenMetadata mirrors AgentEnrolmentTokenMetadata on the TS side.
type EnrolmentTokenMetadata struct {
	Tags []TagPair `json:"tags,omitempty"`
}

// EnrolmentToken represents a row from the agent_enrolment_tokens table.
type EnrolmentToken struct {
	ID             string
	OrganisationID string
	Label          string
	Token          string
	AutoApprove    bool
	MaxUses        *int
	UsageCount     int
	ExpiresAt      *time.Time
	Metadata       EnrolmentTokenMetadata
}

// GetEnrolmentToken looks up a valid (non-deleted, non-expired, not exhausted)
// enrolment token by its token value.
//
// New tokens store a SHA-256 hex digest in token_hash; the primary match is
// against the hash so the plaintext is never compared in cleartext. Tokens
// created before the token_hash column was added (token_hash IS NULL) fall
// back to a direct plaintext comparison during the migration window.
func GetEnrolmentToken(ctx context.Context, pool *pgxpool.Pool, token string) (*EnrolmentToken, error) {
	const q = `
		SELECT id, organisation_id, label, token, auto_approve, max_uses, usage_count, expires_at, metadata
		FROM agent_enrolment_tokens
		WHERE (token_hash = encode(sha256($1::bytea), 'hex') OR (token_hash IS NULL AND token = $1::text))
		  AND deleted_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		  AND (max_uses IS NULL OR usage_count < max_uses)
	`
	row := pool.QueryRow(ctx, q, token)

	var t EnrolmentToken
	var rawMeta []byte
	if err := row.Scan(
		&t.ID, &t.OrganisationID, &t.Label, &t.Token,
		&t.AutoApprove, &t.MaxUses, &t.UsageCount, &t.ExpiresAt, &rawMeta,
	); err != nil {
		return nil, err
	}
	if len(rawMeta) > 0 {
		// Best-effort — a malformed or unexpected metadata shape should not
		// block registration.
		_ = json.Unmarshal(rawMeta, &t.Metadata)
	}
	return &t, nil
}

// IncrementUsageCount atomically bumps the usage counter for an enrolment token.
func IncrementUsageCount(ctx context.Context, pool *pgxpool.Pool, tokenID string) error {
	const q = `UPDATE agent_enrolment_tokens SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1`
	_, err := pool.Exec(ctx, q, tokenID)
	return err
}
