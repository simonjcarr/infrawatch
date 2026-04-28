package queries

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PatchUpdateInput struct {
	Name             string `json:"name"`
	CurrentVersion   string `json:"current_version"`
	AvailableVersion string `json:"available_version"`
	Architecture     string `json:"architecture"`
	Repository       string `json:"repository"`
}

func UpsertHostPatchStatus(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, checkID, status string,
	lastPatchedAt *time.Time,
	patchAgeDays *int,
	maxAgeDays int,
	packageManager string,
	updatesSupported bool,
	updatesCount int,
	updatesTruncated bool,
	warningsJSON []byte,
	errorMessage string,
	checkedAt time.Time,
) error {
	const q = `
		INSERT INTO host_patch_statuses (
			id, organisation_id, host_id, check_id, status, last_patched_at,
			patch_age_days, max_age_days, package_manager, updates_supported,
			updates_count, updates_truncated, warnings, error, checked_at,
			created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, NOW(), NOW())
		ON CONFLICT (check_id)
		DO UPDATE SET
			status = EXCLUDED.status,
			last_patched_at = EXCLUDED.last_patched_at,
			patch_age_days = EXCLUDED.patch_age_days,
			max_age_days = EXCLUDED.max_age_days,
			package_manager = EXCLUDED.package_manager,
			updates_supported = EXCLUDED.updates_supported,
			updates_count = EXCLUDED.updates_count,
			updates_truncated = EXCLUDED.updates_truncated,
			warnings = EXCLUDED.warnings,
			error = EXCLUDED.error,
			checked_at = EXCLUDED.checked_at,
			updated_at = NOW()
	`
	_, err := pool.Exec(ctx, q,
		newCUID(), orgID, hostID, nullableString(checkID), status, lastPatchedAt,
		patchAgeDays, maxAgeDays, nullableString(packageManager), updatesSupported,
		updatesCount, updatesTruncated, string(warningsJSON), nullableString(errorMessage), checkedAt,
	)
	return err
}

func ReplaceCurrentPackageUpdates(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, packageManager string,
	updates []PatchUpdateInput,
	seenAt time.Time,
) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE host_package_updates
		SET status = 'resolved',
		    resolved_at = $4,
		    updated_at = NOW()
		WHERE organisation_id = $1
		  AND host_id = $2
		  AND COALESCE(package_manager, '') = COALESCE($3, '')
		  AND status = 'current'
	`, orgID, hostID, nullableString(packageManager), seenAt); err != nil {
		return err
	}

	const insertQ = `
		INSERT INTO host_package_updates (
			id, organisation_id, host_id, name, current_version, available_version,
			architecture, repository, package_manager, status, first_seen_at,
			last_seen_at, resolved_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'current', $10, $10, NULL, NOW(), NOW())
	`
	for _, update := range updates {
		if update.Name == "" {
			continue
		}
		tag, err := tx.Exec(ctx, `
			UPDATE host_package_updates
			SET status = 'current',
			    last_seen_at = $9,
			    resolved_at = NULL,
			    repository = $7,
			    updated_at = NOW()
			WHERE organisation_id = $1
			  AND host_id = $2
			  AND name = $3
			  AND current_version IS NOT DISTINCT FROM $4
			  AND available_version IS NOT DISTINCT FROM $5
			  AND architecture IS NOT DISTINCT FROM $6
			  AND package_manager IS NOT DISTINCT FROM $8
		`,
			orgID, hostID, update.Name,
			nullableString(update.CurrentVersion),
			nullableString(update.AvailableVersion),
			nullableString(update.Architecture),
			nullableString(update.Repository),
			nullableString(packageManager),
			seenAt,
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			continue
		}

		if _, err := tx.Exec(ctx, insertQ,
			newCUID(), orgID, hostID, update.Name,
			nullableString(update.CurrentVersion),
			nullableString(update.AvailableVersion),
			nullableString(update.Architecture),
			nullableString(update.Repository),
			nullableString(packageManager),
			seenAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func MarshalWarnings(warnings []string) []byte {
	b, err := json.Marshal(warnings)
	if err != nil {
		return []byte("[]")
	}
	return b
}
