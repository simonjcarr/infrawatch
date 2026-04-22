package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/BurntSushi/toml"
)

// Config is the top-level agent configuration loaded from a TOML file.
type Config struct {
	Ingest IngestConfig `toml:"ingest"`
	Agent  AgentConfig  `toml:"agent"`
}

type IngestConfig struct {
	// Address is host:port of the ingest gRPC service.
	Address string `toml:"address"`
	// CACertFile is the path to the server's CA certificate for TLS verification.
	// If empty, system root CAs are used.
	CACertFile string `toml:"ca_cert_file"`
	// TLSSkipVerify disables TLS certificate verification. Insecure — for development only.
	TLSSkipVerify bool `toml:"tls_skip_verify"`
}

type AgentConfig struct {
	// OrgToken is the enrolment token from the Infrawatch UI.
	OrgToken string `toml:"org_token"`
	// DataDir is where the agent stores its keypair and state.
	DataDir string `toml:"data_dir"`
	// HeartbeatIntervalSecs is how often the agent sends a heartbeat.
	HeartbeatIntervalSecs int `toml:"heartbeat_interval_secs"`
	// Tags applied on registration. Each entry is "key:value" or "key=value".
	Tags []string `toml:"tags"`
}

// Load reads a TOML config file and applies INFRAWATCH_ environment overrides.
func Load(path string) (*Config, error) {
	cfg := defaults()

	if fi, err := os.Stat(path); err == nil {
		if err := checkFilePermissions(path, fi); err != nil {
			return nil, err
		}
		if _, err := toml.DecodeFile(path, cfg); err != nil {
			return nil, fmt.Errorf("parsing config %s: %w", path, err)
		}
	}

	applyEnv(cfg)
	return cfg, nil
}

func defaults() *Config {
	return &Config{
		Ingest: IngestConfig{
			Address: "localhost:9443",
		},
		Agent: AgentConfig{
			DataDir:               "/var/lib/infrawatch/agent",
			HeartbeatIntervalSecs: 30,
		},
	}
}

func applyEnv(cfg *Config) {
	if v := os.Getenv("INFRAWATCH_INGEST_ADDRESS"); v != "" {
		cfg.Ingest.Address = v
	}
	if v := os.Getenv("INFRAWATCH_INGEST_CA_CERT"); v != "" {
		cfg.Ingest.CACertFile = v
	}
	if v := os.Getenv("INFRAWATCH_ORG_TOKEN"); v != "" {
		cfg.Agent.OrgToken = v
	}
	if v := os.Getenv("INFRAWATCH_DATA_DIR"); v != "" {
		cfg.Agent.DataDir = v
	}
	// Trim accidental whitespace from tokens/addresses
	cfg.Agent.OrgToken = strings.TrimSpace(cfg.Agent.OrgToken)
	cfg.Ingest.Address = strings.TrimSpace(cfg.Ingest.Address)
}
