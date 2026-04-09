package queries

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ServiceAccountRow is a minimal service account row.
type ServiceAccountRow struct {
	ID                  string
	Username            string
	UID                 int
	GID                 int
	HomeDirectory       string
	Shell               string
	AccountType         string
	HasLoginCapability  bool
	HasRunningProcesses bool
	Status              string
}

// UpsertServiceAccount inserts or updates a service account by the natural key
// (organisation_id, host_id, username). Returns the ID, whether it was an insert,
// and the previous row (nil on insert).
func UpsertServiceAccount(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID string,
	username string, uid, gid int,
	homeDir, shell, accountType string,
	hasLogin, hasProcs bool,
	status string,
) (id string, wasInsert bool, previous *ServiceAccountRow, err error) {
	const selectQ = `
		SELECT id, username, uid, gid, home_directory, shell, account_type,
		       has_login_capability, has_running_processes, status
		FROM service_accounts
		WHERE organisation_id = $1
		  AND host_id = $2
		  AND username = $3
		  AND deleted_at IS NULL
		LIMIT 1
	`
	var existing ServiceAccountRow
	rowErr := pool.QueryRow(ctx, selectQ, orgID, hostID, username).Scan(
		&existing.ID, &existing.Username, &existing.UID, &existing.GID,
		&existing.HomeDirectory, &existing.Shell, &existing.AccountType,
		&existing.HasLoginCapability, &existing.HasRunningProcesses, &existing.Status,
	)

	if rowErr != nil && !errors.Is(rowErr, pgx.ErrNoRows) {
		return "", false, nil, rowErr
	}

	if errors.Is(rowErr, pgx.ErrNoRows) {
		const insertQ = `
			INSERT INTO service_accounts (
				id, organisation_id, host_id, username,
				uid, gid, home_directory, shell, account_type,
				has_login_capability, has_running_processes, status,
				first_seen_at, last_seen_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4,
				$5, $6, $7, $8, $9,
				$10, $11, $12,
				NOW(), NOW(), NOW(), NOW()
			)
			RETURNING id
		`
		newID := newCUID()
		var returnedID string
		err = pool.QueryRow(ctx, insertQ,
			newID, orgID, hostID, username,
			uid, gid, homeDir, shell, accountType,
			hasLogin, hasProcs, status,
		).Scan(&returnedID)
		if err != nil {
			return "", false, nil, err
		}
		return returnedID, true, nil, nil
	}

	// Update existing row.
	const updateQ = `
		UPDATE service_accounts
		SET uid                   = $2,
		    gid                   = $3,
		    home_directory        = $4,
		    shell                 = $5,
		    account_type          = $6,
		    has_login_capability  = $7,
		    has_running_processes = $8,
		    status                = $9,
		    last_seen_at          = NOW(),
		    updated_at            = NOW()
		WHERE id = $1
	`
	_, err = pool.Exec(ctx, updateQ,
		existing.ID, uid, gid, homeDir, shell, accountType,
		hasLogin, hasProcs, status,
	)
	if err != nil {
		return "", false, nil, err
	}
	return existing.ID, false, &existing, nil
}

// GetServiceAccountsForHost returns all non-deleted service accounts for a host.
func GetServiceAccountsForHost(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID string,
) ([]ServiceAccountRow, error) {
	const q = `
		SELECT id, username, uid, gid, home_directory, shell, account_type,
		       has_login_capability, has_running_processes, status
		FROM service_accounts
		WHERE organisation_id = $1
		  AND host_id = $2
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ServiceAccountRow
	for rows.Next() {
		var r ServiceAccountRow
		if err := rows.Scan(
			&r.ID, &r.Username, &r.UID, &r.GID,
			&r.HomeDirectory, &r.Shell, &r.AccountType,
			&r.HasLoginCapability, &r.HasRunningProcesses, &r.Status,
		); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// UpdateServiceAccountStatus sets the status of a service account.
func UpdateServiceAccountStatus(
	ctx context.Context,
	pool *pgxpool.Pool,
	id, status string,
) error {
	const q = `UPDATE service_accounts SET status = $2, updated_at = NOW() WHERE id = $1`
	_, err := pool.Exec(ctx, q, id, status)
	return err
}

// InsertIdentityEvent writes a single event row for a service account or SSH key.
func InsertIdentityEvent(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID string,
	serviceAccountID, sshKeyID *string,
	eventType, message string,
	metadataJSON []byte,
) error {
	const q = `
		INSERT INTO identity_events (
			id, organisation_id, service_account_id, ssh_key_id, host_id,
			event_type, message, occurred_at, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
	`
	var metaPtr *[]byte
	if metadataJSON != nil {
		metaPtr = &metadataJSON
	}
	_, err := pool.Exec(ctx, q,
		newCUID(), orgID, serviceAccountID, sshKeyID, hostID,
		eventType, message, metaPtr,
	)
	return err
}

// GetServiceAccountByUsername looks up a service account by (org, host, username).
func GetServiceAccountByUsername(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, username string,
) (string, error) {
	const q = `
		SELECT id FROM service_accounts
		WHERE organisation_id = $1 AND host_id = $2 AND username = $3 AND deleted_at IS NULL
		LIMIT 1
	`
	var id string
	err := pool.QueryRow(ctx, q, orgID, hostID, username).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// LastSeenCutoff is how long before an account/key is considered truly missing.
var LastSeenCutoff = 0 * time.Second // placeholder — currently mark missing immediately
