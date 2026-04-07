package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/smtp"
	"strings"
	"time"

	"github.com/infrawatch/ingest/internal/db/queries"
)

// AlertEvent is the payload sent to webhook notification channels.
type AlertEvent struct {
	Event     string `json:"event"`     // "alert.fired" | "alert.resolved"
	Severity  string `json:"severity"`  // "info" | "warning" | "critical"
	Host      string `json:"host"`
	Rule      string `json:"rule"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"` // ISO 8601
}

// postWebhook POSTs an AlertEvent to a single URL. If secret is non-empty, an
// HMAC-SHA256 signature is added as X-Infrawatch-Signature. Failures are logged
// and discarded — webhook delivery is best-effort.
func postWebhook(ctx context.Context, url, secret string, event AlertEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		slog.Warn("webhook: marshalling event", "url", url, "err", err)
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		slog.Warn("webhook: building request", "url", url, "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		req.Header.Set("X-Infrawatch-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("webhook: delivery failed", "url", url, "err", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		slog.Warn("webhook: non-2xx response", "url", url, "status", resp.StatusCode)
	}
}

// smtpChannelConfig matches the JSONB stored in notification_channels.config for SMTP channels.
// It handles both the current `encryption` field and the legacy `secure` boolean.
type smtpChannelConfig struct {
	Host        string   `json:"host"`
	Port        int      `json:"port"`
	Encryption  string   `json:"encryption"` // 'none' | 'starttls' | 'tls'
	Secure      *bool    `json:"secure"`      // legacy field — superseded by Encryption
	Username    string   `json:"username"`
	Password    string   `json:"password"`
	FromAddress string   `json:"fromAddress"`
	FromName    string   `json:"fromName"`
	ToAddresses []string `json:"toAddresses"`
}

func (c *smtpChannelConfig) effectiveEncryption() string {
	if c.Encryption != "" {
		return c.Encryption
	}
	// Backward compat: derive from old `secure` boolean
	if c.Secure != nil && *c.Secure {
		return "tls"
	}
	return "starttls"
}

// sendSmtpEmail delivers an AlertEvent to a single SMTP channel.
func sendSmtpEmail(cfg smtpChannelConfig, event AlertEvent) error {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	from := cfg.FromAddress
	if cfg.FromName != "" {
		from = fmt.Sprintf("%s <%s>", cfg.FromName, cfg.FromAddress)
	}

	eventLabel := map[string]string{
		"alert.fired":    "FIRING",
		"alert.resolved": "RESOLVED",
		"alert.test":     "TEST",
	}[event.Event]
	if eventLabel == "" {
		eventLabel = strings.ToUpper(event.Event)
	}

	subject := fmt.Sprintf("[Infrawatch] %s — %s on %s", eventLabel, event.Rule, event.Host)
	body := fmt.Sprintf(
		"Alert: %s\r\nSeverity: %s\r\nHost: %s\r\nRule: %s\r\nMessage: %s\r\nTime: %s\r\n",
		event.Event, event.Severity, event.Host, event.Rule, event.Message, event.Timestamp,
	)
	msg := []byte(fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s",
		from,
		strings.Join(cfg.ToAddresses, ", "),
		subject,
		body,
	))

	switch cfg.effectiveEncryption() {
	case "tls":
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: cfg.Host})
		if err != nil {
			return fmt.Errorf("tls dial: %w", err)
		}
		client, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			return fmt.Errorf("smtp client: %w", err)
		}
		defer client.Close()
		if cfg.Username != "" {
			if err := client.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
				return fmt.Errorf("smtp auth: %w", err)
			}
		}
		return smtpSend(client, cfg.FromAddress, cfg.ToAddresses, msg)

	case "starttls":
		client, err := smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("smtp dial: %w", err)
		}
		defer client.Close()
		if err := client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
		if cfg.Username != "" {
			if err := client.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
				return fmt.Errorf("smtp auth: %w", err)
			}
		}
		return smtpSend(client, cfg.FromAddress, cfg.ToAddresses, msg)

	default: // "none"
		var auth smtp.Auth
		if cfg.Username != "" {
			auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
		}
		if err := smtp.SendMail(addr, auth, cfg.FromAddress, cfg.ToAddresses, msg); err != nil {
			return fmt.Errorf("smtp sendmail: %w", err)
		}
		return nil
	}
}

func smtpSend(client *smtp.Client, from string, to []string, msg []byte) error {
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("MAIL FROM: %w", err)
	}
	for _, addr := range to {
		if err := client.Rcpt(addr); err != nil {
			return fmt.Errorf("RCPT TO %s: %w", addr, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("write body: %w", err)
	}
	return w.Close()
}

// dispatchSmtp fans out an AlertEvent to all configured SMTP channels.
// Each delivery runs in its own goroutine; failures are logged and discarded.
func dispatchSmtp(smtpChannels []queries.SmtpChannelRow, event AlertEvent) {
	for _, ch := range smtpChannels {
		var cfg smtpChannelConfig
		if err := json.Unmarshal([]byte(ch.ConfigJSON), &cfg); err != nil {
			slog.Warn("dispatchSmtp: unmarshal channel config", "channel_id", ch.ID, "err", err)
			continue
		}
		go func(c smtpChannelConfig) {
			if err := sendSmtpEmail(c, event); err != nil {
				slog.Warn("smtp: delivery failed", "host", c.Host, "err", err)
			}
		}(cfg)
	}
}
