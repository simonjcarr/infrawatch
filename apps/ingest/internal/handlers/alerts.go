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
	slack    []queries.SlackChannelRow
	telegram []queries.TelegramChannelRow
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

	slackChs, err := queries.GetEnabledSlackChannels(ctx, pool, orgID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching slack channels", "org_id", orgID, "err", err)
	} else {
		channels.slack = slackChs
	}

	telegramChs, err := queries.GetEnabledTelegramChannels(ctx, pool, orgID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching telegram channels", "org_id", orgID, "err", err)
	} else {
		channels.telegram = telegramChs
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
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, rule.OrgID, id, "host", hostID, ev)
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
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, rule.OrgID, existing.ID, "host", hostID, ev)
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
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, rule.OrgID, id, "host", hostID, ev)
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
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, rule.OrgID, existing.ID, "host", hostID, ev)
	}
}

// certExpiryConfig is the JSONB config for cert_expiry alert rules.
type certExpiryConfig struct {
	CertificateID    string `json:"certificateId,omitempty"` // only when scope == "specific"
	Scope            string `json:"scope"`                   // "all" | "specific"
	DaysBeforeExpiry int    `json:"daysBeforeExpiry"`
}

// evaluateCertExpiryForCert is called immediately after a cert is upserted.
// It loads all cert_expiry rules for the org and evaluates them against the
// freshly-observed cert.
func evaluateCertExpiryForCert(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, certID, commonName, issuer, host string, port int,
	notAfter time.Time, status string,
) {
	rules, err := queries.GetCertExpiryRulesForOrg(ctx, pool, orgID)
	if err != nil {
		slog.Warn("evaluateCertExpiry: fetching rules", "org_id", orgID, "err", err)
		return
	}
	if len(rules) == 0 {
		return
	}

	webhooks, _ := queries.GetEnabledWebhookChannels(ctx, pool, orgID)
	smtpChs, _ := queries.GetEnabledSmtpChannels(ctx, pool, orgID)
	slackChs, _ := queries.GetEnabledSlackChannels(ctx, pool, orgID)
	telegramChs, _ := queries.GetEnabledTelegramChannels(ctx, pool, orgID)
	channels := notifChannels{webhooks: webhooks, smtp: smtpChs, slack: slackChs, telegram: telegramChs}

	cert := queries.CertSummary{
		ID:         certID,
		CommonName: commonName,
		Issuer:     issuer,
		Host:       host,
		Port:       port,
		NotAfter:   notAfter,
		Status:     status,
	}

	for _, rule := range rules {
		evaluateCertExpiryRule(ctx, pool, orgID, rule, cert, channels)
	}
}

// evaluateCertExpiryRule fires or resolves a single cert_expiry rule against one cert.
func evaluateCertExpiryRule(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID string,
	rule queries.AlertRuleRow,
	cert queries.CertSummary,
	channels notifChannels,
) {
	var cfg certExpiryConfig
	if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
		slog.Warn("evaluateCertExpiryRule: unmarshal config", "rule_id", rule.ID, "err", err)
		return
	}
	if cfg.DaysBeforeExpiry < 1 {
		return
	}

	// Scope filter: if rule targets a specific cert, skip all others.
	if cfg.Scope == "specific" && cfg.CertificateID != "" && cfg.CertificateID != cert.ID {
		return
	}

	// If the cert has no discoveredByHostId, we cannot satisfy the NOT NULL FK on alert_instances.
	hostID := cert.DiscoveredByHostID
	if hostID == "" {
		slog.Debug("evaluateCertExpiryRule: cert has no discovered_by_host_id, skipping", "cert_id", cert.ID)
		return
	}

	warnDate := time.Now().Add(time.Duration(cfg.DaysBeforeExpiry) * 24 * time.Hour)
	conditionMet := cert.NotAfter.Before(warnDate) // cert expires within the threshold window

	existing, err := queries.GetActiveCertAlertInstance(ctx, pool, rule.ID, cert.ID)
	if err != nil {
		slog.Warn("evaluateCertExpiryRule: checking active instance", "rule_id", rule.ID, "err", err)
		return
	}

	if conditionMet && existing == nil {
		// Fire a new alert instance.
		daysLeft := int(time.Until(cert.NotAfter).Hours() / 24)
		var message string
		if daysLeft <= 0 {
			message = fmt.Sprintf("Certificate expired: %s (issuer: %s) on %s:%d expired %d days ago",
				cert.CommonName, cert.Issuer, cert.Host, cert.Port, -daysLeft)
		} else {
			message = fmt.Sprintf("Certificate expiring soon: %s (issuer: %s) on %s:%d expires in %d days",
				cert.CommonName, cert.Issuer, cert.Host, cert.Port, daysLeft)
		}

		id, err := queries.InsertCertAlertInstance(ctx, pool, rule.ID, hostID, orgID, rule.Severity, message, cert.ID, time.Now())
		if err != nil {
			slog.Warn("evaluateCertExpiryRule: inserting alert instance", "rule_id", rule.ID, "err", err)
			return
		}
		slog.Info("cert_expiry alert fired", "instance_id", id, "rule", rule.Name, "cert_cn", cert.CommonName)
		ev := AlertEvent{
			Event:     "alert.fired",
			Severity:  rule.Severity,
			Host:      fmt.Sprintf("%s:%d", cert.Host, cert.Port),
			Rule:      rule.Name,
			Message:   message,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, orgID, id, "certificate", cert.ID, ev)
		return
	}

	if !conditionMet && existing != nil {
		// Resolve the alert — cert is no longer within the warning window.
		if err := queries.ResolveAlertInstance(ctx, pool, existing.ID, time.Now()); err != nil {
			slog.Warn("evaluateCertExpiryRule: resolving alert instance", "instance_id", existing.ID, "err", err)
			return
		}
		slog.Info("cert_expiry alert resolved", "instance_id", existing.ID, "rule", rule.Name, "cert_cn", cert.CommonName)
		ev := AlertEvent{
			Event:     "alert.resolved",
			Severity:  rule.Severity,
			Host:      fmt.Sprintf("%s:%d", cert.Host, cert.Port),
			Rule:      rule.Name,
			Message:   fmt.Sprintf("Certificate %s on %s:%d is no longer within the expiry warning window", cert.CommonName, cert.Host, cert.Port),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, orgID, existing.ID, "certificate", cert.ID, ev)
	}
}

// RunCertExpirySweeper periodically evaluates all cert_expiry rules for all orgs.
// This catches certs that drift into the warning window without a new scan.
func RunCertExpirySweeper(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("cert expiry sweeper started", "interval", interval)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runCertExpirySweep(ctx, pool)
		}
	}
}

func runCertExpirySweep(ctx context.Context, pool *pgxpool.Pool) {
	orgIDs, err := queries.GetAllOrgsWithCertExpiryRules(ctx, pool)
	if err != nil {
		slog.Warn("cert sweeper: fetching orgs", "err", err)
		return
	}

	for _, orgID := range orgIDs {
		rules, err := queries.GetCertExpiryRulesForOrg(ctx, pool, orgID)
		if err != nil {
			slog.Warn("cert sweeper: fetching rules", "org_id", orgID, "err", err)
			continue
		}

		webhooks, _ := queries.GetEnabledWebhookChannels(ctx, pool, orgID)
		smtpChs, _ := queries.GetEnabledSmtpChannels(ctx, pool, orgID)
		slackChs, _ := queries.GetEnabledSlackChannels(ctx, pool, orgID)
		telegramChs, _ := queries.GetEnabledTelegramChannels(ctx, pool, orgID)
		channels := notifChannels{webhooks: webhooks, smtp: smtpChs, slack: slackChs, telegram: telegramChs}

		for _, rule := range rules {
			var cfg certExpiryConfig
			if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
				continue
			}

			var certs []queries.CertSummary
			if cfg.Scope == "specific" && cfg.CertificateID != "" {
				cert, err := queries.GetCertificateByID(ctx, pool, orgID, cfg.CertificateID)
				if err != nil || cert == nil {
					continue
				}
				certs = []queries.CertSummary{*cert}
			} else {
				certs, err = queries.ListCertificatesExpiringWithin(ctx, pool, orgID, cfg.DaysBeforeExpiry+1)
				if err != nil {
					slog.Warn("cert sweeper: fetching certs", "org_id", orgID, "err", err)
					continue
				}
			}

			for _, cert := range certs {
				evaluateCertExpiryRule(ctx, pool, orgID, rule, cert, channels)
			}
		}
	}
	slog.Debug("cert expiry sweep complete", "orgs_checked", len(orgIDs))
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
