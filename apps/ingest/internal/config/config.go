package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the ingest service configuration loaded from a YAML file.
type Config struct {
	GRPCPort    int       `yaml:"grpc_port"`
	HTTPPort    int       `yaml:"http_port"`
	DatabaseURL string    `yaml:"database_url"`
	TLS         TLSConfig `yaml:"tls"`
	JWT         JWTConfig `yaml:"jwt"`
	Queue       QueueConfig `yaml:"queue"`
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
	return cfg, nil
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
}
