package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infrawatch/ingest/internal/db/queries"
)

// heartbeatMetrics holds the current metric values from a heartbeat for alert evaluation.
type heartbeatMetrics struct {
	CPU    float32
	Memory float32
	Disk   float32
}

// checkStatusConfig is the JSONB config for check_status alert rules.
type checkStatusConfig struct {
	CheckID          string `json:"checkId"`
	FailureThreshold int    `json:"failureThreshold"`
}

// metricThresholdConfig is the JSONB config for metric_threshold alert rules.
type metricThresholdConfig struct {
	Metric    string  `json:"metric"`    // "cpu" | "memory" | "disk"
	Operator  string  `json:"operator"`  // "gt" | "lt"
	Threshold float64 `json:"threshold"` // 0–100
}

// webhookChannelConfig matches the JSONB stored in notification_channels.config for webhook channels.
type webhookChannelConfig struct {
	URL    string `json:"url"`
	Secret string `json:"secret"`
}

// notifChannels bundles all notification channel types for a single dispatch call.
type notifChannels struct {
	webhooks []queries.WebhookChannelRow
	smtp     []queries.SmtpChannelRow
}

// evaluateAlerts is called after check results are persisted for a heartbeat.
// checkStatuses is a map of checkID → latest status from the current heartbeat batch.
func evaluateAlerts(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, hostname string,
	checkStatuses map[string]string,
	metrics heartbeatMetrics,
) {
	// Skip evaluation entirely if the host is currently silenced.
	silenced, err := queries.IsHostSilenced(ctx, pool, orgID, hostID)
	if err != nil {
		slog.Warn("evaluateAlerts: checking silence", "host_id", hostID, "err", err)
	} else if silenced {
		slog.Debug("evaluateAlerts: host silenced, skipping", "host_id", hostID)
		return
	}

	rules, err := queries.GetAlertRulesForHost(ctx, pool, orgID, hostID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching rules", "host_id", hostID, "err", err)
		return
	}
	if len(rules) == 0 {
		return
	}

	var channels notifChannels

	webhooks, err := queries.GetEnabledWebhookChannels(ctx, pool, orgID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching webhook channels", "org_id", orgID, "err", err)
	} else {
		channels.webhooks = webhooks
	}

	smtpChs, err := queries.GetEnabledSmtpChannels(ctx, pool, orgID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching smtp channels", "org_id", orgID, "err", err)
	} else {
		channels.smtp = smtpChs
	}

	for _, rule := range rules {
		switch rule.ConditionType {
		case "check_status":
			evaluateCheckStatusRule(ctx, pool, rule, hostID, hostname, checkStatuses, channels)
		case "metric_threshold":
			evaluateMetricThresholdRule(ctx, pool, rule, hostID, hostname, metrics, channels)
		}
	}
}

func evaluateCheckStatusRule(
	ctx context.Context,
	pool *pgxpool.Pool,
	rule queries.AlertRuleRow,
	hostID, hostname string,
	checkStatuses map[string]string,
	channels notifChannels,
) {
	var cfg checkStatusConfig
	if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
		slog.Warn("evaluateAlerts: unmarshal check_status config", "rule_id", rule.ID, "err", err)
		return
	}
	if cfg.FailureThreshold < 1 {
		return
	}

	// Fetch the most recent N results (N = failureThreshold).
	results, err := queries.GetRecentCheckResults(ctx, pool, cfg.CheckID, cfg.FailureThreshold)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching check results", "check_id", cfg.CheckID, "err", err)
		return
	}

	// Not enough history yet — skip.
	if len(results) < cfg.FailureThreshold {
		return
	}

	allFailing := true
	for _, r := range results {
		if r.Status != "fail" && r.Status != "error" {
			allFailing = false
			break
		}
	}
	latestPassing := results[0].Status == "pass"

	existing, err := queries.GetActiveAlertInstance(ctx, pool, rule.ID, hostID)
	if err != nil {
		slog.Warn("evaluateAlerts: checking active instance", "rule_id", rule.ID, "err", err)
		return
	}

	if allFailing && existing == nil {
		// Fire a new alert.
		message := fmt.Sprintf("Check failed %d consecutive time(s) on host %s", cfg.FailureThreshold, hostname)
		id, err := queries.InsertAlertInstance(ctx, pool, rule.ID, hostID, rule.OrgID, rule.Severity, message, time.Now())
		if err != nil {
			slog.Warn("evaluateAlerts: inserting alert instance", "rule_id", rule.ID, "err", err)
			return
		}
		slog.Info("alert fired", "instance_id", id, "rule", rule.Name, "host", hostname)
		ev := AlertEvent{
			Event:     "alert.fired",
			Severity:  rule.Severity,
			Host:      hostname,
			Rule:      rule.Name,
			Message:   message,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
		return
	}

	if latestPassing && existing != nil {
		// Resolve the active alert.
		if err := queries.ResolveAlertInstance(ctx, pool, existing.ID, time.Now()); err != nil {
			slog.Warn("evaluateAlerts: resolving alert instance", "instance_id", existing.ID, "err", err)
			return
		}
		slog.Info("alert resolved", "instance_id", existing.ID, "rule", rule.Name, "host", hostname)
		ev := AlertEvent{
			Event:     "alert.resolved",
			Severity:  rule.Severity,
			Host:      hostname,
			Rule:      rule.Name,
			Message:   fmt.Sprintf("Check recovered on host %s", hostname),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
	}
}

func evaluateMetricThresholdRule(
	ctx context.Context,
	pool *pgxpool.Pool,
	rule queries.AlertRuleRow,
	hostID, hostname string,
	metrics heartbeatMetrics,
	channels notifChannels,
) {
	var cfg metricThresholdConfig
	if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
		slog.Warn("evaluateAlerts: unmarshal metric_threshold config", "rule_id", rule.ID, "err", err)
		return
	}

	var currentValue float64
	switch cfg.Metric {
	case "cpu":
		currentValue = float64(metrics.CPU)
	case "memory":
		currentValue = float64(metrics.Memory)
	case "disk":
		currentValue = float64(metrics.Disk)
	default:
		return
	}

	conditionMet := (cfg.Operator == "gt" && currentValue > cfg.Threshold) ||
		(cfg.Operator == "lt" && currentValue < cfg.Threshold)

	existing, err := queries.GetActiveAlertInstance(ctx, pool, rule.ID, hostID)
	if err != nil {
		slog.Warn("evaluateAlerts: checking active instance", "rule_id", rule.ID, "err", err)
		return
	}

	if conditionMet && existing == nil {
		operatorLabel := ">"
		if cfg.Operator == "lt" {
			operatorLabel = "<"
		}
		message := fmt.Sprintf("%s %s %.1f%% (current: %.1f%%) on host %s",
			cfg.Metric, operatorLabel, cfg.Threshold, currentValue, hostname)
		id, err := queries.InsertAlertInstance(ctx, pool, rule.ID, hostID, rule.OrgID, rule.Severity, message, time.Now())
		if err != nil {
			slog.Warn("evaluateAlerts: inserting alert instance", "rule_id", rule.ID, "err", err)
			return
		}
		slog.Info("alert fired", "instance_id", id, "rule", rule.Name, "host", hostname)
		ev := AlertEvent{
			Event:     "alert.fired",
			Severity:  rule.Severity,
			Host:      hostname,
			Rule:      rule.Name,
			Message:   message,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
		return
	}

	if !conditionMet && existing != nil {
		if err := queries.ResolveAlertInstance(ctx, pool, existing.ID, time.Now()); err != nil {
			slog.Warn("evaluateAlerts: resolving alert instance", "instance_id", existing.ID, "err", err)
			return
		}
		slog.Info("alert resolved", "instance_id", existing.ID, "rule", rule.Name, "host", hostname)
		ev := AlertEvent{
			Event:     "alert.resolved",
			Severity:  rule.Severity,
			Host:      hostname,
			Rule:      rule.Name,
			Message:   fmt.Sprintf("%s recovered on host %s (current: %.1f%%)", cfg.Metric, hostname, currentValue),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
	}
}

// dispatchWebhooks fans out an AlertEvent to all configured webhook channels.
// Each delivery runs in its own goroutine; failures are logged and discarded.
func dispatchWebhooks(ctx context.Context, channels []queries.WebhookChannelRow, event AlertEvent) {
	for _, ch := range channels {
		var cfg webhookChannelConfig
		if err := json.Unmarshal([]byte(ch.ConfigJSON), &cfg); err != nil {
			slog.Warn("dispatchWebhooks: unmarshal channel config", "channel_id", ch.ID, "err", err)
			continue
		}
		go postWebhook(ctx, cfg.URL, cfg.Secret, event)
	}
}
