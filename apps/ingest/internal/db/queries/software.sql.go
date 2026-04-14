package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// HostOrgForTaskRunHost returns the host_id and organisation_id for a given
// task_run_hosts row, also checking that the row belongs to the given agent.
type HostOrgForTask struct {
	HostID string
	OrgID  string
}

// GetHostOrgForTaskRunHost looks up the host and org for a task_run_hosts row,
// validating that the host's agent matches the caller.
func GetHostOrgForTaskRunHost(ctx context.Context, pool *pgxpool.Pool, taskRunHostID, agentID string) (*HostOrgForTask, error) {
	const q = `
		SELECT h.id, h.organisation_id
		FROM task_run_hosts trh
		JOIN hosts h ON h.id = trh.host_id
		WHERE trh.id       = $1
		  AND h.agent_id   = $2
		  AND trh.deleted_at IS NULL
		  AND h.deleted_at   IS NULL
		LIMIT 1
	`
	var r HostOrgForTask
	err := pool.QueryRow(ctx, q, taskRunHostID, agentID).Scan(&r.HostID, &r.OrgID)
	return &r, err
}

// InsertSoftwareScan inserts a new software_scans row with status='running' and
// returns the generated scan ID.
func InsertSoftwareScan(ctx context.Context, pool *pgxpool.Pool, orgID, hostID, taskRunHostID, source string, startedAt time.Time) (string, error) {
	id := newCUID()
	const q = `
		INSERT INTO software_scans
		  (id, organisation_id, host_id, task_run_host_id, status, source, started_at, created_at)
		VALUES ($1, $2, $3, $4, 'running', $5, $6, NOW())
	`
	_, err := pool.Exec(ctx, q, id, orgID, hostID, nullableString(taskRunHostID), nullableString(source), startedAt)
	return id, err
}

// UpsertSoftwarePackagesBatch upserts a batch of packages for a given host.
// Returns the number of newly-inserted rows and the number of updates.
func UpsertSoftwarePackagesBatch(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, source string,
	names, versions, archs, publishers []string,
	installDates []int64,
	lastSeenAt time.Time,
) (added int, err error) {
	if len(names) == 0 {
		return 0, nil
	}

	// Build per-row IDs for new inserts (ON CONFLICT rows reuse the existing ID).
	ids := make([]string, len(names))
	for i := range ids {
		ids[i] = newCUID()
	}

	// Convert install dates to nullable timestamps.
	installTimestamps := make([]*time.Time, len(installDates))
	for i, unix := range installDates {
		if unix > 0 {
			t := time.Unix(unix, 0).UTC()
			installTimestamps[i] = &t
		}
	}

	// UNNEST bulk upsert. On conflict we update last_seen_at, clear removed_at,
	// and refresh the publisher. We detect inserts via (xmax = 0).
	const q = `
		WITH ins AS (
		  INSERT INTO software_packages
		    (id, organisation_id, host_id, name, version, architecture, publisher, source,
		     install_date, first_seen_at, last_seen_at, created_at, updated_at)
		  SELECT
		    unnest($1::text[]),
		    $2, $3,
		    unnest($4::text[]),
		    unnest($5::text[]),
		    unnest($6::text[]),
		    unnest($7::text[]),
		    $8,
		    unnest($9::timestamptz[]),
		    $10, $10, $10, $10
		  ON CONFLICT (organisation_id, host_id, name, version, architecture)
		  DO UPDATE SET
		    last_seen_at = EXCLUDED.last_seen_at,
		    publisher    = COALESCE(EXCLUDED.publisher, software_packages.publisher),
		    removed_at   = NULL,
		    updated_at   = NOW()
		  RETURNING (xmax = 0) AS was_inserted
		)
		SELECT COUNT(*) FILTER (WHERE was_inserted) FROM ins
	`

	err = pool.QueryRow(ctx, q,
		ids, orgID, hostID,
		names, versions, archs, publishers,
		source,
		installTimestamps,
		lastSeenAt,
	).Scan(&added)
	return added, err
}

// MarkRemovedPackages sets removed_at = now() on all packages for the given
// host whose last_seen_at predates scanStartedAt. Returns the count of rows
// marked as removed.
func MarkRemovedPackages(ctx context.Context, pool *pgxpool.Pool, hostID string, scanStartedAt time.Time) (int, error) {
	const q = `
		WITH upd AS (
		  UPDATE software_packages
		  SET removed_at = NOW(),
		      updated_at = NOW()
		  WHERE host_id     = $1
		    AND removed_at  IS NULL
		    AND last_seen_at < $2
		    AND deleted_at  IS NULL
		  RETURNING id
		)
		SELECT COUNT(*) FROM upd
	`
	var count int
	err := pool.QueryRow(ctx, q, hostID, scanStartedAt).Scan(&count)
	return count, err
}

// CompleteSoftwareScan finalises a software_scans row with outcome counts.
func CompleteSoftwareScan(
	ctx context.Context,
	pool *pgxpool.Pool,
	scanID string,
	packageCount, added, removed, unchanged int,
	completedAt time.Time,
) error {
	const q = `
		UPDATE software_scans
		SET status         = 'success',
		    package_count  = $2,
		    added_count    = $3,
		    removed_count  = $4,
		    unchanged_count = $5,
		    completed_at   = $6
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, scanID, packageCount, added, removed, unchanged, completedAt)
	return err
}

// FailSoftwareScan marks a software_scans row as failed.
func FailSoftwareScan(ctx context.Context, pool *pgxpool.Pool, scanID, msg string) error {
	const q = `
		UPDATE software_scans
		SET status        = 'failed',
		    error_message = $2,
		    completed_at  = NOW()
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, scanID, msg)
	return err
}

// UpdateHostLastSoftwareScanAt stamps the hosts.metadata JSONB field with the
// time of the most recent successful scan.
func UpdateHostLastSoftwareScanAt(ctx context.Context, pool *pgxpool.Pool, hostID string, scannedAt time.Time) error {
	const q = `
		UPDATE hosts
		SET metadata   = COALESCE(metadata, '{}'::jsonb) ||
		                   jsonb_build_object('lastSoftwareScanAt', $2::text),
		    updated_at = NOW()
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, hostID, scannedAt.UTC().Format(time.RFC3339))
	return err
}

// SoftwareSweeperHost is a minimal host row returned by the sweeper query.
type SoftwareSweeperHost struct {
	ID     string
	OrgID  string
}

// GetHostsDueForSoftwareScan returns hosts belonging to organisations that have
// software inventory enabled and whose last scan is older than the configured
// interval (or who have never been scanned).
func GetHostsDueForSoftwareScan(ctx context.Context, pool *pgxpool.Pool) ([]SoftwareSweeperHost, error) {
	const q = `
		SELECT h.id, h.organisation_id
		FROM hosts h
		JOIN organisations o ON o.id = h.organisation_id
		WHERE h.deleted_at IS NULL
		  AND o.deleted_at IS NULL
		  AND h.status     = 'online'
		  -- Organisation must have software inventory enabled
		  AND (o.metadata->'softwareInventorySettings'->>'enabled')::boolean = true
		  -- Host is overdue: never scanned OR last scan older than intervalHours
		  AND (
		    h.metadata->>'lastSoftwareScanAt' IS NULL
		    OR (
		      NOW() - (h.metadata->>'lastSoftwareScanAt')::timestamptz
		      > (
		          COALESCE(
		            (o.metadata->'softwareInventorySettings'->>'intervalHours')::int,
		            24
		          ) || ' hours'
		        )::interval
		    )
		  )
		  -- Skip hosts that already have a pending or running software_inventory task
		  AND NOT EXISTS (
		    SELECT 1
		    FROM task_run_hosts trh
		    JOIN task_runs tr ON tr.id = trh.task_run_id
		    WHERE trh.host_id   = h.id
		      AND tr.task_type  = 'software_inventory'
		      AND trh.status    IN ('pending', 'running')
		      AND trh.deleted_at IS NULL
		  )
	`
	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []SoftwareSweeperHost
	for rows.Next() {
		var h SoftwareSweeperHost
		if err := rows.Scan(&h.ID, &h.OrgID); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, rows.Err()
}

// InsertSoftwareInventoryTask creates a task_runs row and a single
// task_run_hosts row for an automated software inventory scan.
func InsertSoftwareInventoryTask(ctx context.Context, pool *pgxpool.Pool, orgID, hostID string) (taskRunHostID string, err error) {
	taskRunID := newCUID()
	taskRunHostID = newCUID()

	const qRun = `
		INSERT INTO task_runs
		  (id, organisation_id, triggered_by, target_type, target_id,
		   task_type, config, max_parallel, status, created_at, updated_at)
		VALUES ($1, $2, NULL, 'host', $3, 'software_inventory', '{}', 1, 'pending', NOW(), NOW())
	`
	if _, err = pool.Exec(ctx, qRun, taskRunID, orgID, hostID); err != nil {
		return "", err
	}

	const qHost = `
		INSERT INTO task_run_hosts
		  (id, organisation_id, task_run_id, host_id, status, raw_output, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'pending', '', NOW(), NOW())
	`
	_, err = pool.Exec(ctx, qHost, taskRunHostID, orgID, taskRunID, hostID)
	return taskRunHostID, err
}
