package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AgentRow represents a row from the agents table.
type AgentRow struct {
	ID             string
	OrganisationID string
	Hostname       string
	PublicKey      string
	Status         string
	Version        *string
	EnrolmentTokenID *string
}

// GetAgentByPublicKey retrieves an agent by its public key (for idempotent registration).
func GetAgentByPublicKey(ctx context.Context, pool *pgxpool.Pool, publicKey string) (*AgentRow, error) {
	const q = `
		SELECT id, organisation_id, hostname, public_key, status, version, enrolment_token_id
		FROM agents
		WHERE public_key = $1 AND deleted_at IS NULL
	`
	row := pool.QueryRow(ctx, q, publicKey)

	var a AgentRow
	if err := row.Scan(
		&a.ID, &a.OrganisationID, &a.Hostname, &a.PublicKey, &a.Status,
		&a.Version, &a.EnrolmentTokenID,
	); err != nil {
		return nil, err
	}
	return &a, nil
}

// InsertAgent inserts a new agent row and returns the generated ID.
func InsertAgent(ctx context.Context, pool *pgxpool.Pool, orgID, hostname, publicKey, status, tokenID string) (string, error) {
	const q = `
		INSERT INTO agents (id, organisation_id, hostname, public_key, status, enrolment_token_id)
		VALUES (gen_cuid(), $1, $2, $3, $4, $5)
		RETURNING id
	`
	var id string
	err := pool.QueryRow(ctx, q, orgID, hostname, publicKey, status, nullableString(tokenID)).Scan(&id)
	if err != nil {
		// gen_cuid() may not exist; fall back to a simple cuid-like value from the app
		return insertAgentWithID(ctx, pool, orgID, hostname, publicKey, status, tokenID)
	}
	return id, nil
}

func insertAgentWithID(ctx context.Context, pool *pgxpool.Pool, orgID, hostname, publicKey, status, tokenID string) (string, error) {
	const q = `
		INSERT INTO agents (id, organisation_id, hostname, public_key, status, enrolment_token_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`
	id := newCUID()
	_, err := pool.Exec(ctx, q, id, orgID, hostname, publicKey, status, nullableString(tokenID))
	return id, err
}

// SetAgentStatus updates an agent's status and records the change time.
func SetAgentStatus(ctx context.Context, pool *pgxpool.Pool, agentID, status string) error {
	const q = `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`
	_, err := pool.Exec(ctx, q, status, agentID)
	return err
}

// ApproveAgent marks an agent as active and records the approval time.
func ApproveAgent(ctx context.Context, pool *pgxpool.Pool, agentID string) error {
	const q = `UPDATE agents SET status = 'active', approved_at = NOW(), updated_at = NOW() WHERE id = $1`
	_, err := pool.Exec(ctx, q, agentID)
	return err
}

// UpdateAgentHeartbeat updates the last_heartbeat_at timestamp for an agent.
func UpdateAgentHeartbeat(ctx context.Context, pool *pgxpool.Pool, agentID string, t time.Time) error {
	const q = `UPDATE agents SET last_heartbeat_at = $1, status = 'active', updated_at = NOW() WHERE id = $2`
	_, err := pool.Exec(ctx, q, t, agentID)
	return err
}

// InsertAgentStatusHistory appends a status history entry.
func InsertAgentStatusHistory(ctx context.Context, pool *pgxpool.Pool, agentID, orgID, status string, actorID *string, reason string) error {
	const q = `
		INSERT INTO agent_status_history (id, agent_id, organisation_id, status, actor_id, reason)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := pool.Exec(ctx, q, newCUID(), agentID, orgID, status, actorID, reason)
	return err
}

// GetAgentByID retrieves an agent by its primary key.
func GetAgentByID(ctx context.Context, pool *pgxpool.Pool, agentID string) (*AgentRow, error) {
	const q = `
		SELECT id, organisation_id, hostname, public_key, status, version, enrolment_token_id
		FROM agents
		WHERE id = $1 AND deleted_at IS NULL
	`
	row := pool.QueryRow(ctx, q, agentID)

	var a AgentRow
	if err := row.Scan(
		&a.ID, &a.OrganisationID, &a.Hostname, &a.PublicKey, &a.Status,
		&a.Version, &a.EnrolmentTokenID,
	); err != nil {
		return nil, err
	}
	return &a, nil
}

func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
