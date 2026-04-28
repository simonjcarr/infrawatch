package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
)

type patchStatusCheckReport struct {
	Status           string                     `json:"status"`
	LastPatchedAt    string                     `json:"last_patched_at"`
	PatchAgeDays     *int                       `json:"patch_age_days"`
	MaxAgeDays       int                        `json:"max_age_days"`
	PackageManager   string                     `json:"package_manager"`
	UpdatesSupported bool                       `json:"updates_supported"`
	UpdatesCount     int                        `json:"updates_count"`
	UpdatesTruncated bool                       `json:"updates_truncated"`
	Updates          []queries.PatchUpdateInput `json:"updates"`
	Warnings         []string                   `json:"warnings"`
	Error            string                     `json:"error"`
}

func persistPatchStatusResult(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, checkID string,
	ranAt time.Time,
	output string,
) {
	var report patchStatusCheckReport
	if err := json.Unmarshal([]byte(output), &report); err != nil {
		slog.Warn("patch_status: unmarshal report", "check_id", checkID, "err", err)
		return
	}
	if report.Status == "" {
		report.Status = "unknown"
	}
	if report.MaxAgeDays <= 0 {
		report.MaxAgeDays = 30
	}

	var lastPatchedAt *time.Time
	if report.LastPatchedAt != "" {
		if parsed, err := time.Parse(time.RFC3339, report.LastPatchedAt); err == nil {
			lastPatchedAt = &parsed
		}
	}

	if err := queries.UpsertHostPatchStatus(
		ctx,
		pool,
		orgID,
		hostID,
		checkID,
		report.Status,
		lastPatchedAt,
		report.PatchAgeDays,
		report.MaxAgeDays,
		report.PackageManager,
		report.UpdatesSupported,
		report.UpdatesCount,
		report.UpdatesTruncated,
		queries.MarshalWarnings(report.Warnings),
		report.Error,
		ranAt,
	); err != nil {
		slog.Warn("patch_status: upsert host patch status", "check_id", checkID, "err", err)
		return
	}

	if report.UpdatesSupported {
		if err := queries.ReplaceCurrentPackageUpdates(ctx, pool, orgID, hostID, report.PackageManager, report.Updates, ranAt); err != nil {
			slog.Warn("patch_status: replace package updates", "check_id", checkID, "err", err)
		}
	}
}
