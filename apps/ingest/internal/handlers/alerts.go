package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
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

// dockerContainerAlertConfig is the JSONB config for docker_container alert rules.
type dockerContainerAlertConfig struct {
	Rule              string  `json:"rule"`
	DockerContainerID string  `json:"dockerContainerId,omitempty"`
	WindowMinutes     int     `json:"windowMinutes"`
	Threshold         float64 `json:"threshold"`
	SampleThreshold   int     `json:"sampleThreshold,omitempty"`
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
	instanceID, hostID, hostname string,
	checkStatuses map[string]string,
	metrics heartbeatMetrics,
) {
	// Skip evaluation entirely if the host is currently silenced.
	silenced, err := queries.IsHostSilenced(ctx, pool, instanceID, hostID)
	if err != nil {
		slog.Warn("evaluateAlerts: checking silence", "host_id", hostID, "err", err)
	} else if silenced {
		slog.Debug("evaluateAlerts: host silenced, skipping", "host_id", hostID)
		return
	}

	rules, err := queries.GetAlertRulesForHost(ctx, pool, instanceID, hostID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching rules", "host_id", hostID, "err", err)
		return
	}
	if len(rules) == 0 {
		return
	}

	var channels notifChannels

	webhooks, err := queries.GetEnabledWebhookChannels(ctx, pool, instanceID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching webhook channels", "instance_id", instanceID, "err", err)
	} else {
		channels.webhooks = webhooks
	}

	smtpChs, err := queries.GetEnabledSmtpChannels(ctx, pool, instanceID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching smtp channels", "instance_id", instanceID, "err", err)
	} else {
		channels.smtp = smtpChs
	}

	slackChs, err := queries.GetEnabledSlackChannels(ctx, pool, instanceID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching slack channels", "instance_id", instanceID, "err", err)
	} else {
		channels.slack = slackChs
	}

	telegramChs, err := queries.GetEnabledTelegramChannels(ctx, pool, instanceID)
	if err != nil {
		slog.Warn("evaluateAlerts: fetching telegram channels", "instance_id", instanceID, "err", err)
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

func evaluateDockerContainerAlerts(
	ctx context.Context,
	pool *pgxpool.Pool,
	instanceID, hostID, hostname string,
	now time.Time,
) {
	silenced, err := queries.IsHostSilenced(ctx, pool, instanceID, hostID)
	if err != nil {
		slog.Warn("evaluateDockerContainerAlerts: checking silence", "host_id", hostID, "err", err)
	} else if silenced {
		return
	}

	rules, err := queries.GetAlertRulesForHost(ctx, pool, instanceID, hostID)
	if err != nil {
		slog.Warn("evaluateDockerContainerAlerts: fetching rules", "host_id", hostID, "err", err)
		return
	}

	webhooks, _ := queries.GetEnabledWebhookChannels(ctx, pool, instanceID)
	smtpChs, _ := queries.GetEnabledSmtpChannels(ctx, pool, instanceID)
	slackChs, _ := queries.GetEnabledSlackChannels(ctx, pool, instanceID)
	telegramChs, _ := queries.GetEnabledTelegramChannels(ctx, pool, instanceID)
	channels := notifChannels{webhooks: webhooks, smtp: smtpChs, slack: slackChs, telegram: telegramChs}

	for _, rule := range rules {
		if rule.ConditionType != "docker_container" {
			continue
		}
		evaluateDockerContainerAlertRule(ctx, pool, rule, hostID, hostname, now, channels)
	}
}

func evaluateDockerContainerAlertRule(
	ctx context.Context,
	pool *pgxpool.Pool,
	rule queries.AlertRuleRow,
	hostID, hostname string,
	now time.Time,
	channels notifChannels,
) {
	var cfg dockerContainerAlertConfig
	if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
		slog.Warn("evaluateDockerContainerAlerts: unmarshal config", "rule_id", rule.ID, "err", err)
		return
	}
	normaliseDockerContainerAlertConfig(&cfg)

	conditionMet, detail, err := dockerContainerAlertCondition(ctx, pool, rule.InstanceID, hostID, cfg, now)
	if err != nil {
		slog.Warn("evaluateDockerContainerAlerts: evaluating rule", "rule_id", rule.ID, "err", err)
		return
	}

	existing, err := queries.GetActiveAlertInstance(ctx, pool, rule.ID, hostID)
	if err != nil {
		slog.Warn("evaluateDockerContainerAlerts: checking active instance", "rule_id", rule.ID, "err", err)
		return
	}

	if conditionMet && existing == nil {
		message := fmt.Sprintf("%s on host %s", detail, hostname)
		id, err := queries.InsertAlertInstance(ctx, pool, rule.ID, hostID, rule.InstanceID, rule.Severity, message, now)
		if err != nil {
			slog.Warn("evaluateDockerContainerAlerts: inserting alert instance", "rule_id", rule.ID, "err", err)
			return
		}
		ev := AlertEvent{
			Event:     "alert.fired",
			Severity:  rule.Severity,
			Host:      hostname,
			Rule:      rule.Name,
			Message:   message,
			Timestamp: now.UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, rule.InstanceID, id, "host", hostID, ev)
		return
	}

	if !conditionMet && existing != nil {
		if err := queries.ResolveAlertInstance(ctx, pool, existing.ID, now); err != nil {
			slog.Warn("evaluateDockerContainerAlerts: resolving alert instance", "instance_id", existing.ID, "err", err)
			return
		}
		ev := AlertEvent{
			Event:     "alert.resolved",
			Severity:  rule.Severity,
			Host:      hostname,
			Rule:      rule.Name,
			Message:   fmt.Sprintf("Docker container condition recovered on host %s", hostname),
			Timestamp: now.UTC().Format(time.RFC3339),
		}
		dispatchWebhooks(ctx, channels.webhooks, ev)
		dispatchSmtp(channels.smtp, ev)
		dispatchSlack(ctx, channels.slack, ev)
		dispatchTelegram(ctx, channels.telegram, ev)
		dispatchInApp(ctx, pool, rule.InstanceID, existing.ID, "host", hostID, ev)
	}
}

func normaliseDockerContainerAlertConfig(cfg *dockerContainerAlertConfig) {
	if cfg.WindowMinutes < 1 {
		cfg.WindowMinutes = 10
	}
	if cfg.WindowMinutes > 1440 {
		cfg.WindowMinutes = 1440
	}
	if cfg.SampleThreshold < 1 {
		cfg.SampleThreshold = 3
	}
	if cfg.SampleThreshold > 1000 {
		cfg.SampleThreshold = 1000
	}
	cfg.DockerContainerID = strings.TrimSpace(cfg.DockerContainerID)
	switch cfg.Rule {
	case "memory_near_limit", "sustained_cpu":
		if cfg.Threshold <= 0 || cfg.Threshold > 100 {
			cfg.Threshold = 90
		}
	case "high_network_io":
		if cfg.Threshold <= 0 {
			cfg.Threshold = 1024 * 1024
		}
		if cfg.Threshold > 1_000_000_000_000 {
			cfg.Threshold = 1_000_000_000_000
		}
	case "container_missing":
		if cfg.Threshold <= 0 {
			cfg.Threshold = 5
		}
		if cfg.Threshold > 1440 {
			cfg.Threshold = 1440
		}
	default:
		cfg.Rule = "restart_loop"
		if cfg.Threshold <= 0 {
			cfg.Threshold = 3
		}
		if cfg.Threshold > 1000 {
			cfg.Threshold = 1000
		}
	}
}

func dockerContainerAlertCondition(
	ctx context.Context,
	pool *pgxpool.Pool,
	instanceID, hostID string,
	cfg dockerContainerAlertConfig,
	now time.Time,
) (bool, string, error) {
	windowStart := now.Add(-time.Duration(cfg.WindowMinutes) * time.Minute)
	switch cfg.Rule {
	case "restart_loop":
		return dockerRestartLoopAlertCondition(ctx, pool, instanceID, hostID, cfg, windowStart)
	case "memory_near_limit":
		return dockerMetricSampleAlertCondition(ctx, pool, instanceID, hostID, cfg, windowStart, "memory_percent", "memory")
	case "sustained_cpu":
		return dockerSustainedCPUAlertCondition(ctx, pool, instanceID, hostID, cfg, windowStart)
	case "container_missing":
		return dockerContainerMissingAlertCondition(ctx, pool, instanceID, hostID, cfg, now)
	case "high_network_io":
		return dockerNetworkIOAlertCondition(ctx, pool, instanceID, hostID, cfg, windowStart)
	default:
		return false, "", nil
	}
}

func dockerRestartLoopAlertCondition(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, cfg dockerContainerAlertConfig, windowStart time.Time) (bool, string, error) {
	const q = `
		SELECT COALESCE(e.primary_name, e.docker_container_id), COUNT(*)::int
		FROM docker_container_lifecycle_events e
		WHERE e.instance_id = $1
		  AND e.host_id = $2
		  AND e.event_type = 'restarted'
		  AND e.occurred_at >= $3
		  AND ($4 = '' OR e.docker_container_id = $4)
		GROUP BY e.docker_container_id, e.primary_name
		HAVING COUNT(*) >= $5
		ORDER BY COUNT(*) DESC, COALESCE(e.primary_name, e.docker_container_id) ASC
		LIMIT 1
	`
	var name string
	var restarts int
	err := pool.QueryRow(ctx, q, instanceID, hostID, windowStart, cfg.DockerContainerID, int(cfg.Threshold)).Scan(&name, &restarts)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", nil
		}
		return false, "", err
	}
	return true, fmt.Sprintf("Container %s restarted %d times in %d minutes", name, restarts, cfg.WindowMinutes), nil
}

func dockerMetricSampleAlertCondition(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, cfg dockerContainerAlertConfig, windowStart time.Time, column string, label string) (bool, string, error) {
	q := fmt.Sprintf(`
		SELECT COALESCE(dc.primary_name, dc.docker_container_id), COUNT(*) FILTER (WHERE m.%[1]s >= $5)::int, MAX(m.%[1]s)::double precision
		FROM docker_container_metrics m
		INNER JOIN docker_containers dc ON dc.id = m.docker_container_row_id
		WHERE m.instance_id = $1
		  AND m.host_id = $2
		  AND m.recorded_at >= $3
		  AND ($4 = '' OR m.docker_container_id = $4)
		GROUP BY dc.docker_container_id, dc.primary_name
		HAVING COUNT(*) FILTER (WHERE m.%[1]s >= $5) >= $6
		ORDER BY MAX(m.%[1]s) DESC NULLS LAST
		LIMIT 1
	`, column)
	var name string
	var samples int
	var maxValue float64
	err := pool.QueryRow(ctx, q, instanceID, hostID, windowStart, cfg.DockerContainerID, cfg.Threshold, cfg.SampleThreshold).Scan(&name, &samples, &maxValue)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", nil
		}
		return false, "", err
	}
	return true, fmt.Sprintf("Container %s %s reached %.1f%% across %d samples", name, label, maxValue, samples), nil
}

func dockerSustainedCPUAlertCondition(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, cfg dockerContainerAlertConfig, windowStart time.Time) (bool, string, error) {
	const q = `
		SELECT COALESCE(dc.primary_name, dc.docker_container_id), COUNT(*)::int, AVG(m.cpu_percent)::double precision
		FROM docker_container_metrics m
		INNER JOIN docker_containers dc ON dc.id = m.docker_container_row_id
		WHERE m.instance_id = $1
		  AND m.host_id = $2
		  AND m.recorded_at >= $3
		  AND ($4 = '' OR m.docker_container_id = $4)
		GROUP BY dc.docker_container_id, dc.primary_name
		HAVING COUNT(*) >= $6 AND AVG(m.cpu_percent) >= $5
		ORDER BY AVG(m.cpu_percent) DESC NULLS LAST
		LIMIT 1
	`
	var name string
	var samples int
	var avgCPU float64
	err := pool.QueryRow(ctx, q, instanceID, hostID, windowStart, cfg.DockerContainerID, cfg.Threshold, cfg.SampleThreshold).Scan(&name, &samples, &avgCPU)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", nil
		}
		return false, "", err
	}
	return true, fmt.Sprintf("Container %s averaged %.1f%% CPU across %d samples", name, avgCPU, samples), nil
}

func dockerContainerMissingAlertCondition(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, cfg dockerContainerAlertConfig, now time.Time) (bool, string, error) {
	if cfg.DockerContainerID == "" {
		return false, "", nil
	}
	const q = `
		SELECT COALESCE(primary_name, docker_container_id), last_seen_at
		FROM docker_containers
		WHERE instance_id = $1
		  AND host_id = $2
		  AND docker_container_id = $3
		  AND is_present = false
		  AND last_seen_at <= $4
		LIMIT 1
	`
	missingSince := now.Add(-time.Duration(cfg.Threshold) * time.Minute)
	var name string
	var lastSeen time.Time
	err := pool.QueryRow(ctx, q, instanceID, hostID, cfg.DockerContainerID, missingSince).Scan(&name, &lastSeen)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", nil
		}
		return false, "", err
	}
	return true, fmt.Sprintf("Container %s has been missing since %s", name, lastSeen.UTC().Format(time.RFC3339)), nil
}

func dockerNetworkIOAlertCondition(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, cfg dockerContainerAlertConfig, windowStart time.Time) (bool, string, error) {
	const q = `
		WITH per_container AS (
			SELECT
				dc.docker_container_id,
				COALESCE(dc.primary_name, dc.docker_container_id) AS name,
				COUNT(*)::int AS samples,
				EXTRACT(EPOCH FROM MAX(m.recorded_at) - MIN(m.recorded_at))::double precision AS seconds,
				(MAX(COALESCE(m.network_rx_bytes, 0) + COALESCE(m.network_tx_bytes, 0)) -
				 MIN(COALESCE(m.network_rx_bytes, 0) + COALESCE(m.network_tx_bytes, 0)))::double precision AS bytes_delta
			FROM docker_container_metrics m
			INNER JOIN docker_containers dc ON dc.id = m.docker_container_row_id
			WHERE m.instance_id = $1
			  AND m.host_id = $2
			  AND m.recorded_at >= $3
			  AND ($4 = '' OR m.docker_container_id = $4)
			GROUP BY dc.docker_container_id, dc.primary_name
		)
		SELECT name, samples, bytes_delta / NULLIF(seconds, 0) AS bytes_per_second
		FROM per_container
		WHERE samples >= $6
		  AND seconds > 0
		  AND bytes_delta / NULLIF(seconds, 0) >= $5
		ORDER BY bytes_per_second DESC NULLS LAST
		LIMIT 1
	`
	var name string
	var samples int
	var bytesPerSecond float64
	err := pool.QueryRow(ctx, q, instanceID, hostID, windowStart, cfg.DockerContainerID, cfg.Threshold, max(2, cfg.SampleThreshold)).Scan(&name, &samples, &bytesPerSecond)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", nil
		}
		return false, "", err
	}
	return true, fmt.Sprintf("Container %s averaged %.0f B/s network I/O across %d samples", name, bytesPerSecond, samples), nil
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
		id, err := queries.InsertAlertInstance(ctx, pool, rule.ID, hostID, rule.InstanceID, rule.Severity, message, time.Now())
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
		dispatchInApp(ctx, pool, rule.InstanceID, id, "host", hostID, ev)
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
		dispatchInApp(ctx, pool, rule.InstanceID, existing.ID, "host", hostID, ev)
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
		id, err := queries.InsertAlertInstance(ctx, pool, rule.ID, hostID, rule.InstanceID, rule.Severity, message, time.Now())
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
		dispatchInApp(ctx, pool, rule.InstanceID, id, "host", hostID, ev)
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
		dispatchInApp(ctx, pool, rule.InstanceID, existing.ID, "host", hostID, ev)
	}
}

// certExpiryConfig is the JSONB config for cert_expiry alert rules.
type certExpiryConfig struct {
	CertificateID    string `json:"certificateId,omitempty"` // only when scope == "specific"
	Scope            string `json:"scope"`                   // "all" | "specific"
	DaysBeforeExpiry int    `json:"daysBeforeExpiry"`
}

// evaluateCertExpiryForCert is called immediately after a cert is upserted.
// It loads all cert_expiry rules for the instance and evaluates them against the
// freshly-observed cert.
func evaluateCertExpiryForCert(
	ctx context.Context,
	pool *pgxpool.Pool,
	instanceID, certID, commonName, issuer, host string, port int,
	notAfter time.Time, status string,
) {
	rules, err := queries.GetCertExpiryRulesForInstance(ctx, pool, instanceID)
	if err != nil {
		slog.Warn("evaluateCertExpiry: fetching rules", "instance_id", instanceID, "err", err)
		return
	}
	if len(rules) == 0 {
		return
	}

	webhooks, _ := queries.GetEnabledWebhookChannels(ctx, pool, instanceID)
	smtpChs, _ := queries.GetEnabledSmtpChannels(ctx, pool, instanceID)
	slackChs, _ := queries.GetEnabledSlackChannels(ctx, pool, instanceID)
	telegramChs, _ := queries.GetEnabledTelegramChannels(ctx, pool, instanceID)
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
		evaluateCertExpiryRule(ctx, pool, instanceID, rule, cert, channels)
	}
}

// evaluateCertExpiryRule fires or resolves a single cert_expiry rule against one cert.
func evaluateCertExpiryRule(
	ctx context.Context,
	pool *pgxpool.Pool,
	instanceID string,
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

		id, err := queries.InsertCertAlertInstance(ctx, pool, rule.ID, hostID, instanceID, rule.Severity, message, cert.ID, time.Now())
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
		dispatchInApp(ctx, pool, instanceID, id, "certificate", cert.ID, ev)
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
		dispatchInApp(ctx, pool, instanceID, existing.ID, "certificate", cert.ID, ev)
	}
}

// RunCertExpirySweeper periodically evaluates all cert_expiry rules for all instances.
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
	instanceIDs, err := queries.GetAllInstancesWithCertExpiryRules(ctx, pool)
	if err != nil {
		slog.Warn("cert sweeper: fetching instances", "err", err)
		return
	}

	for _, instanceID := range instanceIDs {
		rules, err := queries.GetCertExpiryRulesForInstance(ctx, pool, instanceID)
		if err != nil {
			slog.Warn("cert sweeper: fetching rules", "instance_id", instanceID, "err", err)
			continue
		}

		webhooks, _ := queries.GetEnabledWebhookChannels(ctx, pool, instanceID)
		smtpChs, _ := queries.GetEnabledSmtpChannels(ctx, pool, instanceID)
		slackChs, _ := queries.GetEnabledSlackChannels(ctx, pool, instanceID)
		telegramChs, _ := queries.GetEnabledTelegramChannels(ctx, pool, instanceID)
		channels := notifChannels{webhooks: webhooks, smtp: smtpChs, slack: slackChs, telegram: telegramChs}

		for _, rule := range rules {
			var cfg certExpiryConfig
			if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
				continue
			}

			var certs []queries.CertSummary
			if cfg.Scope == "specific" && cfg.CertificateID != "" {
				cert, err := queries.GetCertificateByID(ctx, pool, instanceID, cfg.CertificateID)
				if err != nil || cert == nil {
					continue
				}
				certs = []queries.CertSummary{*cert}
			} else {
				certs, err = queries.ListCertificatesExpiringWithin(ctx, pool, instanceID, cfg.DaysBeforeExpiry+1)
				if err != nil {
					slog.Warn("cert sweeper: fetching certs", "instance_id", instanceID, "err", err)
					continue
				}
			}

			for _, cert := range certs {
				evaluateCertExpiryRule(ctx, pool, instanceID, rule, cert, channels)
			}
		}
	}
	slog.Debug("cert expiry sweep complete", "orgs_checked", len(instanceIDs))
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
