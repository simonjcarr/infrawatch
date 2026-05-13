package config

import (
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestLoadAppliesTerminalTrustedOriginsEnv(t *testing.T) {
	t.Setenv("INGEST_TERMINAL_TRUSTED_ORIGINS", " https://app.example.com ,http://localhost:3000, ")

	cfg, err := Load("/tmp/does-not-exist.yaml")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	want := []string{"https://app.example.com", "http://localhost:3000"}
	if !reflect.DeepEqual(cfg.Terminal.TrustedOrigins, want) {
		t.Fatalf("cfg.Terminal.TrustedOrigins = %#v, want %#v", cfg.Terminal.TrustedOrigins, want)
	}
}

func TestLoadAppliesHTTPPortEnv(t *testing.T) {
	t.Setenv("INGEST_HTTP_PORT", "18080")

	cfg, err := Load("/tmp/does-not-exist.yaml")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.HTTPPort != 18080 {
		t.Fatalf("cfg.HTTPPort = %d, want 18080", cfg.HTTPPort)
	}
}

func TestLoadBuildsEncodedDatabaseURLFromPostgresEnv(t *testing.T) {
	t.Setenv("POSTGRES_USER", "ctops")
	t.Setenv("POSTGRES_PASSWORD", "Pyth)n2475##")
	t.Setenv("POSTGRES_HOST", "db")
	t.Setenv("POSTGRES_PORT", "5432")
	t.Setenv("POSTGRES_DB", "ctops")

	cfg, err := Load("/tmp/does-not-exist.yaml")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("cfg.DatabaseURL should parse: %v", err)
	}
	if got, _ := parsed.User.Password(); got != "Pyth)n2475##" {
		t.Fatalf("parsed password = %q, want %q", got, "Pyth)n2475##")
	}

	want := "postgresql://ctops:Pyth%29n2475%23%23@db:5432/ctops"
	if cfg.DatabaseURL != want {
		t.Fatalf("cfg.DatabaseURL = %q, want %q", cfg.DatabaseURL, want)
	}
}

func TestLoadSeedsAgentVersionFromConfiguredReleaseManifest(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, ".release-please-manifest.json")
	if err := os.WriteFile(manifestPath, []byte(`{"agent":"9.9.9"}`), 0o644); err != nil {
		t.Fatalf("writing release manifest: %v", err)
	}
	t.Setenv("INGEST_RELEASE_MANIFEST_PATH", manifestPath)

	cfg, err := Load("/tmp/does-not-exist.yaml")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Agent.LatestVersion != "v9.9.9" {
		t.Fatalf("cfg.Agent.LatestVersion = %q, want %q", cfg.Agent.LatestVersion, "v9.9.9")
	}
}
