package queries

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SshKeyRow is a minimal SSH key row.
type SshKeyRow struct {
	ID                 string
	FingerprintSHA256  string
	FilePath           string
	KeyType            string
	BitLength          int
	Comment            string
	KeySource          string
	AssociatedUsername  string
	ServiceAccountID   *string
	Status             string
	KeyAgeSeconds      *int
}

// UpsertSshKey inserts or updates an SSH key by the natural key
// (organisation_id, host_id, fingerprint_sha256, file_path).
func UpsertSshKey(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID string,
	fingerprint, filePath string,
	keyType string, bitLength int,
	comment, keySource, associatedUsername string,
	serviceAccountID *string,
	keyAgeSeconds *int,
) (id string, wasInsert bool, err error) {
	const selectQ = `
		SELECT id, status
		FROM ssh_keys
		WHERE organisation_id = $1
		  AND host_id = $2
		  AND fingerprint_sha256 = $3
		  AND file_path = $4
		  AND deleted_at IS NULL
		LIMIT 1
	`
	var existingID, existingStatus string
	rowErr := pool.QueryRow(ctx, selectQ, orgID, hostID, fingerprint, filePath).
		Scan(&existingID, &existingStatus)

	if rowErr != nil && !errors.Is(rowErr, pgx.ErrNoRows) {
		return "", false, rowErr
	}

	if errors.Is(rowErr, pgx.ErrNoRows) {
		const insertQ = `
			INSERT INTO ssh_keys (
				id, organisation_id, host_id, service_account_id,
				key_type, bit_length, fingerprint_sha256, comment,
				file_path, key_source, associated_username, status,
				key_age_seconds, first_seen_at, last_seen_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4,
				$5, $6, $7, $8,
				$9, $10, $11, 'active',
				$12, NOW(), NOW(), NOW(), NOW()
			)
			RETURNING id
		`
		newID := newCUID()
		var returnedID string
		err = pool.QueryRow(ctx, insertQ,
			newID, orgID, hostID, serviceAccountID,
			keyType, bitLength, fingerprint, comment,
			filePath, keySource, associatedUsername,
			keyAgeSeconds,
		).Scan(&returnedID)
		if err != nil {
			return "", false, err
		}
		return returnedID, true, nil
	}

	// Update existing row.
	const updateQ = `
		UPDATE ssh_keys
		SET key_type            = $2,
		    bit_length          = $3,
		    comment             = $4,
		    key_source          = $5,
		    associated_username = $6,
		    service_account_id  = $7,
		    key_age_seconds     = $8,
		    status              = 'active',
		    last_seen_at        = NOW(),
		    updated_at          = NOW()
		WHERE id = $1
	`
	_, err = pool.Exec(ctx, updateQ,
		existingID, keyType, bitLength, comment,
		keySource, associatedUsername, serviceAccountID,
		keyAgeSeconds,
	)
	if err != nil {
		return "", false, err
	}

	// If it was previously missing and now found again, treat as "restored"
	wasRestored := existingStatus == "missing"
	if wasRestored {
		return existingID, true, nil // signal as "insert" to trigger restored event
	}
	return existingID, false, nil
}

// GetSshKeysForHost returns all non-deleted SSH keys for a host.
func GetSshKeysForHost(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID string,
) ([]SshKeyRow, error) {
	const q = `
		SELECT id, fingerprint_sha256, file_path, key_type, bit_length,
		       comment, key_source, associated_username, service_account_id,
		       status, key_age_seconds
		FROM ssh_keys
		WHERE organisation_id = $1
		  AND host_id = $2
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SshKeyRow
	for rows.Next() {
		var r SshKeyRow
		if err := rows.Scan(
			&r.ID, &r.FingerprintSHA256, &r.FilePath, &r.KeyType, &r.BitLength,
			&r.Comment, &r.KeySource, &r.AssociatedUsername, &r.ServiceAccountID,
			&r.Status, &r.KeyAgeSeconds,
		); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// UpdateSshKeyStatus sets the status of an SSH key.
func UpdateSshKeyStatus(
	ctx context.Context,
	pool *pgxpool.Pool,
	id, status string,
) error {
	const q = `UPDATE ssh_keys SET status = $2, updated_at = NOW() WHERE id = $1`
	_, err := pool.Exec(ctx, q, id, status)
	return err
}
