package queries

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CertRow is a minimal certificate row returned by certificate queries.
type CertRow struct {
	ID     string
	Status string
}

// CertSummary is used by the cert-expiry sweeper and evaluator.
type CertSummary struct {
	ID                 string
	CommonName         string
	Issuer             string
	Host               string
	Port               int
	NotAfter           time.Time
	Status             string
	DiscoveredByHostID string // may be empty for imported certs
}

// UpsertCertificate inserts or updates a certificate row identified by the
// natural key (organisation_id, host, port, server_name, fingerprint_sha256).
//
// Returns:
//   - certID: the ID of the inserted/updated row
//   - previousStatus: the status before this upsert (empty string on insert)
//   - wasInsert: true if this is a new row
func UpsertCertificate(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, discoveredByHostID, checkID string,
	host string, port int, serverName string,
	commonName, issuer string,
	sans []string,
	notBefore, notAfter time.Time,
	fingerprint, status string,
	detailsJSON []byte,
) (certID, previousStatus string, wasInsert bool, err error) {
	// Try to find an existing row by natural key.
	const selectQ = `
		SELECT id, status
		FROM certificates
		WHERE organisation_id = $1
		  AND host = $2
		  AND port = $3
		  AND server_name = $4
		  AND fingerprint_sha256 = $5
		  AND deleted_at IS NULL
		LIMIT 1
	`
	var existing CertRow
	rowErr := pool.QueryRow(ctx, selectQ, orgID, host, port, serverName, fingerprint).
		Scan(&existing.ID, &existing.Status)

	if rowErr != nil && !errors.Is(rowErr, pgx.ErrNoRows) {
		return "", "", false, rowErr
	}

	sansJSON, _ := json.Marshal(sans)

	if errors.Is(rowErr, pgx.ErrNoRows) {
		// Insert new row.
		const insertQ = `
			INSERT INTO certificates (
				id, organisation_id, discovered_by_host_id, check_id,
				source, host, port, server_name,
				common_name, issuer, sans,
				not_before, not_after, fingerprint_sha256, status,
				details, last_seen_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4,
				'discovered', $5, $6, $7,
				$8, $9, $10,
				$11, $12, $13, $14,
				$15, NOW(), NOW(), NOW()
			)
			RETURNING id
		`
		id := newCUID()
		var returnedID string
		err = pool.QueryRow(ctx, insertQ,
			id, orgID, discoveredByHostID, checkID,
			host, port, serverName,
			commonName, issuer, sansJSON,
			notBefore, notAfter, fingerprint, status,
			detailsJSON,
		).Scan(&returnedID)
		if err != nil {
			return "", "", false, err
		}
		return returnedID, "", true, nil
	}

	// Update existing row.
	const updateQ = `
		UPDATE certificates
		SET status        = $2,
		    common_name   = $3,
		    issuer        = $4,
		    sans          = $5,
		    not_before    = $6,
		    not_after     = $7,
		    details       = $8,
		    last_seen_at  = NOW(),
		    updated_at    = NOW()
		WHERE id = $1
	`
	_, err = pool.Exec(ctx, updateQ,
		existing.ID, status, commonName, issuer, sansJSON,
		notBefore, notAfter, detailsJSON,
	)
	if err != nil {
		return "", "", false, err
	}
	return existing.ID, existing.Status, false, nil
}

// FindCertsForEndpoint returns existing non-deleted certificate rows for the
// given (org, host, port, serverName) tuple — used for renewal detection.
func FindCertsForEndpoint(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, host string, port int, serverName string,
) ([]CertRow, error) {
	const q = `
		SELECT id, status
		FROM certificates
		WHERE organisation_id = $1
		  AND host = $2
		  AND port = $3
		  AND server_name = $4
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID, host, port, serverName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []CertRow
	for rows.Next() {
		var r CertRow
		if err := rows.Scan(&r.ID, &r.Status); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// InsertCertificateEvent writes a single event row for a certificate.
func InsertCertificateEvent(
	ctx context.Context,
	pool *pgxpool.Pool,
	certID, orgID, eventType, previousStatus, newStatus, message string,
	metadataJSON []byte,
) error {
	const q = `
		INSERT INTO certificate_events (
			id, organisation_id, certificate_id,
			event_type, previous_status, new_status, message, occurred_at, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
	`
	var prevPtr, newPtr *string
	if previousStatus != "" {
		prevPtr = &previousStatus
	}
	if newStatus != "" {
		newPtr = &newStatus
	}
	_, err := pool.Exec(ctx, q,
		newCUID(), orgID, certID,
		eventType, prevPtr, newPtr, message, metadataJSON,
	)
	return err
}

// GetActiveCertAlertInstance returns a firing alert_instances row scoped to a
// specific cert_expiry rule + certificate combination (via metadata).
func GetActiveCertAlertInstance(
	ctx context.Context,
	pool *pgxpool.Pool,
	ruleID, certID string,
) (*AlertInstanceRow, error) {
	const q = `
		SELECT id, rule_id, host_id, status, triggered_at
		FROM alert_instances
		WHERE rule_id = $1
		  AND status = 'firing'
		  AND metadata->>'certificateId' = $2
		LIMIT 1
	`
	var r AlertInstanceRow
	err := pool.QueryRow(ctx, q, ruleID, certID).
		Scan(&r.ID, &r.RuleID, &r.HostID, &r.Status, &r.TriggeredAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// InsertCertAlertInstance creates a firing alert_instances row for a cert_expiry rule.
// hostID should be the cert's discovered_by_host_id (must be a valid FK value).
func InsertCertAlertInstance(
	ctx context.Context,
	pool *pgxpool.Pool,
	ruleID, hostID, orgID, severity, message, certID string,
	triggeredAt time.Time,
) (string, error) {
	meta, _ := json.Marshal(map[string]string{"certificateId": certID})
	const q = `
		INSERT INTO alert_instances (id, rule_id, host_id, organisation_id, status, message, triggered_at, metadata)
		VALUES ($1, $2, $3, $4, 'firing', $5, $6, $7)
		RETURNING id
	`
	id := newCUID()
	var returnedID string
	err := pool.QueryRow(ctx, q, id, ruleID, hostID, orgID, message, triggeredAt, meta).Scan(&returnedID)
	return returnedID, err
}

// GetCertExpiryRulesForOrg returns all enabled cert_expiry alert rules for an org.
func GetCertExpiryRulesForOrg(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]AlertRuleRow, error) {
	const q = `
		SELECT id, host_id, organisation_id, name, condition_type, config::text, severity
		FROM alert_rules
		WHERE organisation_id = $1
		  AND condition_type = 'cert_expiry'
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []AlertRuleRow
	for rows.Next() {
		var r AlertRuleRow
		if err := rows.Scan(&r.ID, &r.HostID, &r.OrgID, &r.Name, &r.ConditionType, &r.ConfigJSON, &r.Severity); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetAllOrgsWithCertExpiryRules returns distinct org IDs that have at least one
// enabled cert_expiry rule — used by the sweeper.
func GetAllOrgsWithCertExpiryRules(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	const q = `
		SELECT DISTINCT organisation_id
		FROM alert_rules
		WHERE condition_type = 'cert_expiry'
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

// ListCertificatesExpiringWithin returns certs whose notAfter is within the given
// number of days and that are not deleted.
func ListCertificatesExpiringWithin(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID string,
	days int,
) ([]CertSummary, error) {
	const q = `
		SELECT id, common_name, issuer, host, port, not_after, status, COALESCE(discovered_by_host_id, '')
		FROM certificates
		WHERE organisation_id = $1
		  AND deleted_at IS NULL
		  AND not_after <= NOW() + ($2 || ' days')::interval
	`
	rows, err := pool.Query(ctx, q, orgID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []CertSummary
	for rows.Next() {
		var r CertSummary
		if err := rows.Scan(&r.ID, &r.CommonName, &r.Issuer, &r.Host, &r.Port, &r.NotAfter, &r.Status, &r.DiscoveredByHostID); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetCertificateByID returns a single certificate row by ID (org-scoped).
func GetCertificateByID(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, certID string,
) (*CertSummary, error) {
	const q = `
		SELECT id, common_name, issuer, host, port, not_after, status, COALESCE(discovered_by_host_id, '')
		FROM certificates
		WHERE id = $1
		  AND organisation_id = $2
		  AND deleted_at IS NULL
		LIMIT 1
	`
	var r CertSummary
	err := pool.QueryRow(ctx, q, certID, orgID).
		Scan(&r.ID, &r.CommonName, &r.Issuer, &r.Host, &r.Port, &r.NotAfter, &r.Status, &r.DiscoveredByHostID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}
