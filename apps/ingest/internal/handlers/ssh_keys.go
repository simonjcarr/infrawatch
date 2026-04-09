package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infrawatch/ingest/internal/db/queries"
)

// sshKeyScanReport matches the JSON produced by the agent's ssh_key_scan check.
type sshKeyScanReport struct {
	Keys  []sshKeyEntry `json:"keys"`
	Error string        `json:"error,omitempty"`
}

type sshKeyEntry struct {
	KeyType            string `json:"key_type"`
	BitLength          int    `json:"bit_length,omitempty"`
	FingerprintSHA256  string `json:"fingerprint_sha256"`
	Comment            string `json:"comment,omitempty"`
	FilePath           string `json:"file_path"`
	KeySource          string `json:"key_source"`
	AssociatedUsername string `json:"associated_username"`
	KeyAgeSeconds      int64  `json:"key_age_seconds,omitempty"`
}

// persistSshKeyResult upserts SSH keys from a scan result and emits events.
func persistSshKeyResult(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, checkID, output string,
) {
	var report sshKeyScanReport
	if err := json.Unmarshal([]byte(output), &report); err != nil {
		slog.Warn("ssh-key: unmarshal report", "check_id", checkID, "err", err)
		return
	}

	if report.Error != "" {
		slog.Debug("ssh-key: agent reported error", "check_id", checkID, "error", report.Error)
		return
	}

	// Load existing keys for this host to detect missing keys.
	existingKeys, err := queries.GetSshKeysForHost(ctx, pool, orgID, hostID)
	if err != nil {
		slog.Warn("ssh-key: loading existing keys", "host_id", hostID, "err", err)
	}

	// Track which existing keys are seen in this scan.
	type keyIdentity struct {
		fingerprint string
		filePath    string
	}
	seenKeys := make(map[keyIdentity]bool, len(report.Keys))

	for _, key := range report.Keys {
		seenKeys[keyIdentity{key.FingerprintSHA256, key.FilePath}] = true

		// Resolve service account ID from username.
		var serviceAccountID *string
		if key.AssociatedUsername != "" {
			if saID, err := queries.GetServiceAccountByUsername(ctx, pool, orgID, hostID, key.AssociatedUsername); err == nil && saID != "" {
				serviceAccountID = &saID
			}
		}

		var keyAge *int
		if key.KeyAgeSeconds > 0 {
			age := int(key.KeyAgeSeconds)
			keyAge = &age
		}

		id, wasInsert, err := queries.UpsertSshKey(
			ctx, pool, orgID, hostID,
			key.FingerprintSHA256, key.FilePath,
			key.KeyType, key.BitLength,
			key.Comment, key.KeySource, key.AssociatedUsername,
			serviceAccountID, keyAge,
		)
		if err != nil {
			slog.Warn("ssh-key: upsert", "fingerprint", key.FingerprintSHA256, "err", err)
			continue
		}

		if wasInsert {
			eventType := "key_discovered"
			message := fmt.Sprintf("SSH key discovered: %s %s in %s (user: %s)",
				key.KeyType, truncateFingerprint(key.FingerprintSHA256), key.FilePath, key.AssociatedUsername)

			// Check if this was a restore (key was previously missing, now found again).
			for _, existing := range existingKeys {
				if existing.FingerprintSHA256 == key.FingerprintSHA256 &&
					existing.FilePath == key.FilePath &&
					existing.Status == "missing" {
					eventType = "key_restored"
					message = fmt.Sprintf("SSH key restored: %s %s in %s",
						key.KeyType, truncateFingerprint(key.FingerprintSHA256), key.FilePath)
					break
				}
			}

			if evErr := queries.InsertIdentityEvent(ctx, pool,
				orgID, hostID, nil, &id,
				eventType, message, nil,
			); evErr != nil {
				slog.Warn("ssh-key: insert event", "err", evErr)
			}
			slog.Info("ssh-key: key event", "event", eventType, "fingerprint", truncateFingerprint(key.FingerprintSHA256))
		}
	}

	// Mark keys not in the current scan as missing.
	for _, existing := range existingKeys {
		ki := keyIdentity{existing.FingerprintSHA256, existing.FilePath}
		if seenKeys[ki] || existing.Status == "missing" {
			continue
		}
		if err := queries.UpdateSshKeyStatus(ctx, pool, existing.ID, "missing"); err != nil {
			slog.Warn("ssh-key: marking missing", "id", existing.ID, "err", err)
			continue
		}
		id := existing.ID
		if evErr := queries.InsertIdentityEvent(ctx, pool,
			orgID, hostID, nil, &id,
			"key_missing",
			fmt.Sprintf("SSH key no longer present: %s %s in %s",
				existing.KeyType, truncateFingerprint(existing.FingerprintSHA256), existing.FilePath),
			nil,
		); evErr != nil {
			slog.Warn("ssh-key: insert missing event", "err", evErr)
		}
		slog.Info("ssh-key: key marked missing", "fingerprint", truncateFingerprint(existing.FingerprintSHA256))
	}
}

// truncateFingerprint shortens a SHA256 fingerprint for log messages.
func truncateFingerprint(fp string) string {
	if len(fp) > 16 {
		return fp[:16] + "..."
	}
	return fp
}
