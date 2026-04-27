package config

import (
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
