package config

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the ingest service configuration loaded from a YAML file.
type Config struct {
	GRPCPort    int                   `yaml:"grpc_port"`
	HTTPPort    int                   `yaml:"http_port"`
	DatabaseURL string                `yaml:"database_url"`
	TLS         TLSConfig             `yaml:"tls"`
	JWT         JWTConfig             `yaml:"jwt"`
	Queue       QueueConfig           `yaml:"queue"`
	Agent       AgentDistributionConfig `yaml:"agent"`
}

// AgentDistributionConfig controls agent version management.
type AgentDistributionConfig struct {
	// LatestVersion is the latest agent version string (e.g. "v0.2.0").
	// When an agent heartbeats with a different version, update_available is set.
	// Set via INGEST_LATEST_AGENT_VERSION. Leave empty to disable update signalling.
	LatestVersion string `yaml:"latest_version"`
	// DownloadBaseURL is the base URL of the Infrawatch web app, used to construct
	// the agent download URL returned to agents. E.g. "https://infrawatch.example.com".
	// Set via INGEST_AGENT_DOWNLOAD_BASE_URL.
	DownloadBaseURL string `yaml:"download_base_url"`
}

type TLSConfig struct {
	CertFile string `yaml:"cert_file"`
	KeyFile  string `yaml:"key_file"`
}

type JWTConfig struct {
	// KeyFile is the path to the RSA private key PEM file used to sign agent JWTs.
	// Generated on first start if it does not exist.
	KeyFile     string        `yaml:"key_file"`
	Issuer      string        `yaml:"issuer"`
	TokenTTL    time.Duration `yaml:"token_ttl"`
}

type QueueConfig struct {
	// Type is "inprocess" (buffered channels) or "redpanda".
	Type string `yaml:"type"`
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

	// If no explicit LatestVersion was supplied via YAML or env, try reading
	// it from .release-please-manifest.json. release-please updates this file
	// automatically when it cuts a new agent release, so this keeps the
	// ingest service in sync without any manual env-var bookkeeping — exactly
	// the same source of truth the web app uses (apps/web/lib/agent/version.ts).
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
		"/var/lib/infrawatch/.release-please-manifest.json",
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

func defaults() *Config {
	return &Config{
		GRPCPort:    9443,
		HTTPPort:    8080,
		DatabaseURL: "postgresql://infrawatch:infrawatch@localhost:5432/infrawatch",
		TLS: TLSConfig{
			CertFile: "/etc/infrawatch/tls/server.crt",
			KeyFile:  "/etc/infrawatch/tls/server.key",
		},
		JWT: JWTConfig{
			KeyFile:  "/var/lib/infrawatch/jwt_key.pem",
			Issuer:   "infrawatch-ingest",
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
}
