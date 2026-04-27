package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadRejectsGroupReadableConfig(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "agent.toml")
	if err := os.WriteFile(path, []byte("[agent]\norg_token = \"secret\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected insecure permissions to fail")
	}
	if !strings.Contains(err.Error(), "must not grant group/other access") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadReadsSecureConfig(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "agent.toml")
	if err := os.WriteFile(path, []byte("[ingest]\naddress = \"ingest.example:9443\"\n\n[agent]\norg_token = \"secret\"\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Ingest.Address != "ingest.example:9443" {
		t.Fatalf("unexpected ingest address: %q", cfg.Ingest.Address)
	}
	if cfg.Agent.OrgToken != "secret" {
		t.Fatalf("unexpected org token: %q", cfg.Agent.OrgToken)
	}
}
