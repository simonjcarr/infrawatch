package queries

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AlertRuleRow is a row from the alert_rules table.
type AlertRuleRow struct {
	ID            string
	HostID        *string // nil for org-wide rules
	OrgID         string
	Name          string
	ConditionType string // "check_status" | "metric_threshold"
	ConfigJSON    string // raw JSONB as text
	Severity      string // "info" | "warning" | "critical"
}

// AlertInstanceRow is a minimal row from alert_instances.
type AlertInstanceRow struct {
	ID          string
	RuleID      string
	HostID      string
	Status      string
	TriggeredAt time.Time
}

// AlertCheckResultRow is a minimal row from check_results used for alert evaluation.
type AlertCheckResultRow struct {
	Status string
	RanAt  time.Time
}

// WebhookChannelRow is a row from notification_channels.
type WebhookChannelRow struct {
	ID         string
	ConfigJSON string // raw JSONB as text, shape: { url, secret? }
}

// GetAlertRulesForHost returns all enabled, non-deleted alert rules scoped to the
// given host OR org-wide (host_id IS NULL).
func GetAlertRulesForHost(ctx context.Context, pool *pgxpool.Pool, orgID, hostID string) ([]AlertRuleRow, error) {
	const q = `
		SELECT id, host_id, organisation_id, name, condition_type, config::text, severity
		FROM alert_rules
		WHERE organisation_id = $1
		  AND enabled = true
		  AND deleted_at IS NULL
		  AND (host_id = $2 OR host_id IS NULL)
	`
	rows, err := pool.Query(ctx, q, orgID, hostID)
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

// GetActiveAlertInstance returns the currently firing alert instance for the given
// rule+host pair, or nil if no active instance exists.
func GetActiveAlertInstance(ctx context.Context, pool *pgxpool.Pool, ruleID, hostID string) (*AlertInstanceRow, error) {
	const q = `
		SELECT id, rule_id, host_id, status, triggered_at
		FROM alert_instances
		WHERE rule_id = $1
		  AND host_id = $2
		  AND status = 'firing'
		LIMIT 1
	`
	var r AlertInstanceRow
	err := pool.QueryRow(ctx, q, ruleID, hostID).Scan(&r.ID, &r.RuleID, &r.HostID, &r.Status, &r.TriggeredAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// InsertAlertInstance creates a new firing alert instance and returns its ID.
func InsertAlertInstance(
	ctx context.Context,
	pool *pgxpool.Pool,
	ruleID, hostID, orgID, severity, message string,
	triggeredAt time.Time,
) (string, error) {
	const q = `
		INSERT INTO alert_instances (id, rule_id, host_id, organisation_id, status, message, triggered_at)
		VALUES ($1, $2, $3, $4, 'firing', $5, $6)
		RETURNING id
	`
	id := newCUID()
	var returnedID string
	err := pool.QueryRow(ctx, q, id, ruleID, hostID, orgID, message, triggeredAt).Scan(&returnedID)
	return returnedID, err
}

// ResolveAlertInstance marks a firing instance as resolved.
func ResolveAlertInstance(ctx context.Context, pool *pgxpool.Pool, instanceID string, resolvedAt time.Time) error {
	const q = `
		UPDATE alert_instances
		SET status = 'resolved', resolved_at = $2
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, instanceID, resolvedAt)
	return err
}

// GetRecentCheckResults returns the most recent N check results for the given check,
// ordered newest first. Used by alert evaluation to check consecutive failures.
func GetRecentCheckResults(ctx context.Context, pool *pgxpool.Pool, checkID string, limit int) ([]AlertCheckResultRow, error) {
	const q = `
		SELECT status, ran_at
		FROM check_results
		WHERE check_id = $1
		ORDER BY ran_at DESC
		LIMIT $2
	`
	rows, err := pool.Query(ctx, q, checkID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []AlertCheckResultRow
	for rows.Next() {
		var r AlertCheckResultRow
		if err := rows.Scan(&r.Status, &r.RanAt); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// SmtpChannelRow is a row from notification_channels where type = 'smtp'.
type SmtpChannelRow struct {
	ID         string
	ConfigJSON string // raw JSONB as text
}

// GetEnabledSmtpChannels returns all enabled, non-deleted SMTP notification
// channels for the given organisation.
func GetEnabledSmtpChannels(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]SmtpChannelRow, error) {
	const q = `
		SELECT id, config::text
		FROM notification_channels
		WHERE organisation_id = $1
		  AND type = 'smtp'
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SmtpChannelRow
	for rows.Next() {
		var r SmtpChannelRow
		if err := rows.Scan(&r.ID, &r.ConfigJSON); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// IsHostSilenced returns true if the given host (or the whole org) currently has
// an active silence window covering now.
func IsHostSilenced(ctx context.Context, pool *pgxpool.Pool, orgID, hostID string) (bool, error) {
	const q = `
		SELECT COUNT(*) > 0
		FROM alert_silences
		WHERE organisation_id = $1
		  AND deleted_at IS NULL
		  AND starts_at <= NOW()
		  AND ends_at   >= NOW()
		  AND (host_id = $2 OR host_id IS NULL)
	`
	var silenced bool
	err := pool.QueryRow(ctx, q, orgID, hostID).Scan(&silenced)
	return silenced, err
}

// GetEnabledWebhookChannels returns all enabled, non-deleted webhook notification
// channels for the given organisation.
func GetEnabledWebhookChannels(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]WebhookChannelRow, error) {
	const q = `
		SELECT id, config::text
		FROM notification_channels
		WHERE organisation_id = $1
		  AND type = 'webhook'
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []WebhookChannelRow
	for rows.Next() {
		var r WebhookChannelRow
		if err := rows.Scan(&r.ID, &r.ConfigJSON); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// SlackChannelRow is a row from notification_channels where type = 'slack'.
type SlackChannelRow struct {
	ID         string
	ConfigJSON string // raw JSONB as text, shape: { webhookUrl }
}

// GetEnabledSlackChannels returns all enabled, non-deleted Slack notification
// channels for the given organisation.
func GetEnabledSlackChannels(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]SlackChannelRow, error) {
	const q = `
		SELECT id, config::text
		FROM notification_channels
		WHERE organisation_id = $1
		  AND type = 'slack'
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SlackChannelRow
	for rows.Next() {
		var r SlackChannelRow
		if err := rows.Scan(&r.ID, &r.ConfigJSON); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// TelegramChannelRow is a row from notification_channels where type = 'telegram'.
type TelegramChannelRow struct {
	ID         string
	ConfigJSON string // raw JSONB as text, shape: { botToken, chatId }
}

// GetEnabledTelegramChannels returns all enabled, non-deleted Telegram notification
// channels for the given organisation.
func GetEnabledTelegramChannels(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]TelegramChannelRow, error) {
	const q = `
		SELECT id, config::text
		FROM notification_channels
		WHERE organisation_id = $1
		  AND type = 'telegram'
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []TelegramChannelRow
	for rows.Next() {
		var r TelegramChannelRow
		if err := rows.Scan(&r.ID, &r.ConfigJSON); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// OrgNotificationSettingsRow holds the notification settings from org metadata.
type OrgNotificationSettingsRow struct {
	InAppEnabled   bool
	InAppRoles     []string
	AllowUserOptOut bool
}

// GetOrgNotificationSettings fetches the in-app notification settings for an org.
// Returns sensible defaults if metadata is not set.
func GetOrgNotificationSettings(ctx context.Context, pool *pgxpool.Pool, orgID string) (OrgNotificationSettingsRow, error) {
	const q = `
		SELECT
			COALESCE((metadata->'notificationSettings'->>'inAppEnabled')::boolean, true),
			COALESCE(
				ARRAY(SELECT jsonb_array_elements_text(metadata->'notificationSettings'->'inAppRoles')),
				ARRAY['super_admin','org_admin','engineer']
			),
			COALESCE((metadata->'notificationSettings'->>'allowUserOptOut')::boolean, true)
		FROM organisations
		WHERE id = $1
	`
	var row OrgNotificationSettingsRow
	err := pool.QueryRow(ctx, q, orgID).Scan(&row.InAppEnabled, &row.InAppRoles, &row.AllowUserOptOut)
	if err != nil {
		// Return defaults on error
		return OrgNotificationSettingsRow{
			InAppEnabled:    true,
			InAppRoles:      []string{"super_admin", "org_admin", "engineer"},
			AllowUserOptOut: true,
		}, err
	}
	return row, nil
}

// GetAlertTargetUsers returns user IDs in the org that should receive in-app notifications.
// roles: the roles that are eligible; allowOptOut: if true, exclude users who have opted out.
func GetAlertTargetUsers(ctx context.Context, pool *pgxpool.Pool, orgID string, roles []string, allowOptOut bool) ([]string, error) {
	var q string
	if allowOptOut {
		q = `
			SELECT id FROM "user"
			WHERE organisation_id = $1
			  AND is_active = true
			  AND role = ANY($2)
			  AND notifications_enabled = true
			  AND deleted_at IS NULL
		`
	} else {
		q = `
			SELECT id FROM "user"
			WHERE organisation_id = $1
			  AND is_active = true
			  AND role = ANY($2)
			  AND deleted_at IS NULL
		`
	}
	rows, err := pool.Query(ctx, q, orgID, roles)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// NotificationInsert holds the data for a single notifications row insert.
type NotificationInsert struct {
	OrgID           string
	UserID          string
	AlertInstanceID string // may be empty
	Subject         string
	Body            string
	Severity        string
	ResourceType    string
	ResourceID      string
}

// InsertNotificationBatch bulk-inserts one notification row per user in a single statement.
func InsertNotificationBatch(ctx context.Context, pool *pgxpool.Pool, rows []NotificationInsert) error {
	if len(rows) == 0 {
		return nil
	}

	// Build VALUES list using pgx named args approach via batch
	batch := &pgx.Batch{}
	const q = `
		INSERT INTO notifications
		  (id, organisation_id, user_id, alert_instance_id, subject, body, severity, resource_type, resource_id)
		VALUES ($1, $2, $3, NULLIF($4,''), $5, $6, $7, $8, $9)
	`
	for _, r := range rows {
		batch.Queue(q, newCUID(), r.OrgID, r.UserID, r.AlertInstanceID, r.Subject, r.Body, r.Severity, r.ResourceType, r.ResourceID)
	}

	br := pool.SendBatch(ctx, batch)
	defer br.Close()

	for range rows {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}
