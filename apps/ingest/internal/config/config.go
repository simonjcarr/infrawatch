package config

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const agentReleasesURL = "https://api.github.com/repos/simonjcarr/ct-ops/releases?per_page=20"

// Config is the ingest service configuration loaded from a YAML file.
type Config struct {
	GRPCPort    int                     `yaml:"grpc_port"`
	HTTPPort    int                     `yaml:"http_port"`
	DatabaseURL string                  `yaml:"database_url"`
	TLS         TLSConfig               `yaml:"tls"`
	JWT         JWTConfig               `yaml:"jwt"`
	Queue       QueueConfig             `yaml:"queue"`
	Agent       AgentDistributionConfig `yaml:"agent"`
	Terminal    TerminalConfig          `yaml:"terminal"`
}

// AgentDistributionConfig controls agent version management.
type AgentDistributionConfig struct {
	// LatestVersion is the latest agent version string (e.g. "v0.2.0").
	// When an agent heartbeats with a different version, update_available is set.
	// Set via INGEST_LATEST_AGENT_VERSION. Leave empty to disable update signalling.
	LatestVersion string `yaml:"latest_version"`
	// DownloadBaseURL is the base URL of the CT-Ops web app, used to construct
	// the agent download URL returned to agents. E.g. "https://ct-ops.example.com".
	// Set via INGEST_AGENT_DOWNLOAD_BASE_URL.
	DownloadBaseURL string `yaml:"download_base_url"`
}

type TLSConfig struct {
	CertFile string `yaml:"cert_file"`
	KeyFile  string `yaml:"key_file"`
	// AgentCACertFile / AgentCAKeyFile let an operator bring their own CA.
	// When both are set, the CA is read from disk on boot and mTLS uses it
	// directly (DB row is still upserted so the web UI can display metadata).
	// When unset, the CA is loaded from the DB (or generated on first boot
	// and stored there encrypted).
	AgentCACertFile string `yaml:"agent_ca_cert_file"`
	AgentCAKeyFile  string `yaml:"agent_ca_key_file"`
	// WebServerCertFile points at the browser-facing nginx TLS cert that
	// terminates HTTPS on :443. Ingest reads it so it can push updates down
	// the heartbeat stream when the cert is swapped out, allowing agents to
	// keep verifying their self-update download URL without operator action
	// on each host. Empty disables the rotation RPC.
	WebServerCertFile string `yaml:"web_server_cert_file"`
}

type JWTConfig struct {
	// KeyFile is the path to the RSA private key PEM file used to sign agent JWTs.
	// Generated on first start if it does not exist.
	KeyFile  string        `yaml:"key_file"`
	Issuer   string        `yaml:"issuer"`
	TokenTTL time.Duration `yaml:"token_ttl"`
}

type QueueConfig struct {
	// Type is "inprocess" (buffered channels) or "redpanda".
	Type string `yaml:"type"`
}

type TerminalConfig struct {
	// TrustedOrigins allows cross-origin browser connections to the terminal
	// WebSocket endpoint when INGEST_WS_URL points directly at ingest instead
	// of using same-origin proxying. Leave empty to require same-origin only.
	TrustedOrigins []string `yaml:"trusted_origins"`
}

// Load reads a YAML config file and applies INGEST_ environment overrides.
func Load(path string) (*Config, error) {
	cfg := defaults()

	if _, err := os.Stat(path); err == nil {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("reading config %s: %w", path, err)
		}
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parsing config %s: %w", path, err)
		}
	}

	applyEnv(cfg)

	// If no explicit LatestVersion was supplied via YAML or env, seed from the
	// baked release-please manifest. The VersionPoller refreshes from published
	// release metadata after startup so long-running ingest processes converge
	// with the web UI's latest-agent badge without a restart.
	if cfg.Agent.LatestVersion == "" {
		if v := loadAgentVersionFromManifest(); v != "" {
			cfg.Agent.LatestVersion = v
			slog.Info("loaded agent latest version from release-please manifest", "version", v)
		}
	}
	return cfg, nil
}

// loadAgentVersionFromManifest reads .release-please-manifest.json from one of
// several candidate locations and returns the agent version (prefixed with "v")
// if present. Returns "" if the file cannot be read or has no agent entry.
func loadAgentVersionFromManifest() string {
	candidates := []string{
		os.Getenv("INGEST_RELEASE_MANIFEST_PATH"),
		"/var/lib/ct-ops/.release-please-manifest.json",
		".release-please-manifest.json",
		"../../.release-please-manifest.json",
	}
	for _, path := range candidates {
		if path == "" {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var manifest map[string]string
		if err := json.Unmarshal(data, &manifest); err != nil {
			continue
		}
		if v, ok := manifest["agent"]; ok && v != "" {
			return "v" + v
		}
	}
	return ""
}

func discoverLatestAgentVersion(ctx context.Context) string {
	if v, err := latestAgentVersionFromGitHub(ctx, agentReleasesURL, os.Getenv("GITHUB_TOKEN")); err == nil && v != "" {
		return v
	}
	return loadAgentVersionFromManifest()
}

func latestAgentVersionFromGitHub(ctx context.Context, releasesURL, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("GitHub releases API returned HTTP %d", resp.StatusCode)
	}

	var releases []struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return "", err
	}
	for _, release := range releases {
		if version, ok := strings.CutPrefix(release.TagName, "agent/"); ok && strings.HasPrefix(version, "v") {
			return version, nil
		}
	}
	return "", nil
}

func shouldStoreCandidateVersion(current, candidate string) bool {
	if candidate == "" {
		return false
	}
	if current == "" {
		return true
	}
	candidateParts, candidateOK := parseAgentVersion(candidate)
	currentParts, currentOK := parseAgentVersion(current)
	if !candidateOK || !currentOK {
		return candidate != current
	}
	for i := range candidateParts {
		if candidateParts[i] > currentParts[i] {
			return true
		}
		if candidateParts[i] < currentParts[i] {
			return false
		}
	}
	return true
}

func parseAgentVersion(version string) ([3]int, bool) {
	var out [3]int
	version = strings.TrimPrefix(version, "agent/")
	version = strings.TrimPrefix(version, "v")
	version, _, _ = strings.Cut(version, "-")
	parts := strings.Split(version, ".")
	if len(parts) != len(out) {
		return out, false
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

func defaults() *Config {
	return &Config{
		GRPCPort:    9443,
		HTTPPort:    8080,
		DatabaseURL: "postgresql://ctops:ctops@localhost:5432/ctops",
		TLS: TLSConfig{
			CertFile: "/etc/ct-ops/tls/server.crt",
			KeyFile:  "/etc/ct-ops/tls/server.key",
		},
		JWT: JWTConfig{
			KeyFile:  "/var/lib/ct-ops/jwt_key.pem",
			Issuer:   "ct-ops-ingest",
			TokenTTL: 24 * time.Hour,
		},
		Queue: QueueConfig{
			Type: "inprocess",
		},
	}
}

func applyEnv(cfg *Config) {
	if v := os.Getenv("INGEST_DATABASE_URL"); v != "" {
		cfg.DatabaseURL = v
	}
	if v := os.Getenv("DATABASE_URL"); v != "" {
		cfg.DatabaseURL = v
	}
	if v := os.Getenv("INGEST_GRPC_PORT"); v != "" {
		var port int
		_, _ = fmt.Sscanf(v, "%d", &port)
		if port > 0 {
			cfg.GRPCPort = port
		}
	}
	if v := os.Getenv("INGEST_TLS_CERT"); v != "" {
		cfg.TLS.CertFile = v
	}
	if v := os.Getenv("INGEST_TLS_KEY"); v != "" {
		cfg.TLS.KeyFile = v
	}
	if v := os.Getenv("INGEST_JWT_KEY_FILE"); v != "" {
		cfg.JWT.KeyFile = v
	}
	if v := os.Getenv("INGEST_LATEST_AGENT_VERSION"); v != "" {
		cfg.Agent.LatestVersion = v
	}
	if v := os.Getenv("INGEST_AGENT_DOWNLOAD_BASE_URL"); v != "" {
		cfg.Agent.DownloadBaseURL = v
	}
	if v := os.Getenv("INGEST_AGENT_CA_CERT"); v != "" {
		cfg.TLS.AgentCACertFile = v
	}
	if v := os.Getenv("INGEST_AGENT_CA_KEY"); v != "" {
		cfg.TLS.AgentCAKeyFile = v
	}
	if v := os.Getenv("INGEST_WEB_SERVER_CERT"); v != "" {
		cfg.TLS.WebServerCertFile = v
	}
	if v := os.Getenv("INGEST_TERMINAL_TRUSTED_ORIGINS"); v != "" {
		cfg.Terminal.TrustedOrigins = splitCSV(v)
	}
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		values = append(values, part)
	}
	return values
}
