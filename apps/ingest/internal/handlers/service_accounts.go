package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infrawatch/ingest/internal/db/queries"
)

// serviceAccountReport matches the JSON produced by the agent's service_account check.
type serviceAccountReport struct {
	Accounts []accountEntry `json:"accounts"`
	Error    string         `json:"error,omitempty"`
}

type accountEntry struct {
	Username            string `json:"username"`
	UID                 int    `json:"uid"`
	GID                 int    `json:"gid"`
	HomeDirectory       string `json:"home_directory"`
	Shell               string `json:"shell"`
	AccountType         string `json:"account_type"`
	HasLoginCapability  bool   `json:"has_login_capability"`
	HasRunningProcesses bool   `json:"has_running_processes"`
}

// persistServiceAccountResult upserts service accounts from a scan result and emits events.
func persistServiceAccountResult(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, checkID, output string,
) {
	var report serviceAccountReport
	if err := json.Unmarshal([]byte(output), &report); err != nil {
		slog.Warn("svc-account: unmarshal report", "check_id", checkID, "err", err)
		return
	}

	if report.Error != "" {
		slog.Debug("svc-account: agent reported error", "check_id", checkID, "error", report.Error)
		return
	}

	// Load existing accounts for this host to detect missing accounts.
	existingAccounts, err := queries.GetServiceAccountsForHost(ctx, pool, orgID, hostID)
	if err != nil {
		slog.Warn("svc-account: loading existing accounts", "host_id", hostID, "err", err)
	}

	// Track which existing accounts are seen in this scan.
	seenUsernames := make(map[string]bool, len(report.Accounts))

	for _, acct := range report.Accounts {
		seenUsernames[acct.Username] = true

		status := "active"
		if !acct.HasLoginCapability {
			status = "disabled"
		}

		id, wasInsert, previous, err := queries.UpsertServiceAccount(
			ctx, pool, orgID, hostID,
			acct.Username, acct.UID, acct.GID,
			acct.HomeDirectory, acct.Shell, acct.AccountType,
			acct.HasLoginCapability, acct.HasRunningProcesses,
			status,
		)
		if err != nil {
			slog.Warn("svc-account: upsert", "username", acct.Username, "err", err)
			continue
		}

		if wasInsert && previous == nil {
			// Brand new account discovered.
			if evErr := queries.InsertIdentityEvent(ctx, pool,
				orgID, hostID, &id, nil,
				"account_discovered",
				fmt.Sprintf("Account '%s' discovered (UID %d, type: %s)", acct.Username, acct.UID, acct.AccountType),
				nil,
			); evErr != nil {
				slog.Warn("svc-account: insert discovered event", "err", evErr)
			}
			slog.Info("svc-account: new account discovered", "username", acct.Username, "host_id", hostID)
		} else if wasInsert && previous != nil {
			// This shouldn't happen with current logic, but handle gracefully.
			slog.Debug("svc-account: account restored", "username", acct.Username)
		} else if previous != nil {
			// Existing account — check for changes.
			if previous.Status == "missing" {
				// Account was missing, now restored.
				if evErr := queries.InsertIdentityEvent(ctx, pool,
					orgID, hostID, &id, nil,
					"account_restored",
					fmt.Sprintf("Account '%s' restored (was missing)", acct.Username),
					nil,
				); evErr != nil {
					slog.Warn("svc-account: insert restored event", "err", evErr)
				}
				slog.Info("svc-account: account restored", "username", acct.Username)
			}

			// Check for field changes.
			changes := detectAccountChanges(previous, &acct, status)
			if len(changes) > 0 {
				meta, _ := json.Marshal(changes)
				if evErr := queries.InsertIdentityEvent(ctx, pool,
					orgID, hostID, &id, nil,
					"account_changed",
					fmt.Sprintf("Account '%s' changed: %s", acct.Username, summarizeChanges(changes)),
					meta,
				); evErr != nil {
					slog.Warn("svc-account: insert changed event", "err", evErr)
				}
			}
		}
	}

	// Mark accounts not in the current scan as missing.
	for _, existing := range existingAccounts {
		if seenUsernames[existing.Username] || existing.Status == "missing" {
			continue
		}
		if err := queries.UpdateServiceAccountStatus(ctx, pool, existing.ID, "missing"); err != nil {
			slog.Warn("svc-account: marking missing", "username", existing.Username, "err", err)
			continue
		}
		id := existing.ID
		if evErr := queries.InsertIdentityEvent(ctx, pool,
			orgID, hostID, &id, nil,
			"account_missing",
			fmt.Sprintf("Account '%s' no longer present on host", existing.Username),
			nil,
		); evErr != nil {
			slog.Warn("svc-account: insert missing event", "err", evErr)
		}
		slog.Info("svc-account: account marked missing", "username", existing.Username)
	}
}

type fieldChange struct {
	Field    string `json:"field"`
	Previous string `json:"previous"`
	Current  string `json:"current"`
}

func detectAccountChanges(prev *queries.ServiceAccountRow, curr *accountEntry, newStatus string) []fieldChange {
	var changes []fieldChange
	if prev.Shell != curr.Shell {
		changes = append(changes, fieldChange{"shell", prev.Shell, curr.Shell})
	}
	if prev.HomeDirectory != curr.HomeDirectory {
		changes = append(changes, fieldChange{"home_directory", prev.HomeDirectory, curr.HomeDirectory})
	}
	if prev.AccountType != curr.AccountType {
		changes = append(changes, fieldChange{"account_type", prev.AccountType, curr.AccountType})
	}
	if prev.HasLoginCapability != curr.HasLoginCapability {
		changes = append(changes, fieldChange{"has_login_capability",
			fmt.Sprintf("%v", prev.HasLoginCapability),
			fmt.Sprintf("%v", curr.HasLoginCapability)})
	}
	return changes
}

func summarizeChanges(changes []fieldChange) string {
	if len(changes) == 1 {
		return fmt.Sprintf("%s: %s -> %s", changes[0].Field, changes[0].Previous, changes[0].Current)
	}
	summary := ""
	for i, c := range changes {
		if i > 0 {
			summary += ", "
		}
		summary += c.Field
	}
	return summary
}
