package vuln

import (
	"net/url"
	"testing"
	"time"
)

func TestRedHatCSAFURLWithAfterAddsDefaultWindow(t *testing.T) {
	t.Parallel()

	got := redHatCSAFURLWithAfter("https://access.redhat.com/hydra/rest/securitydata/csaf.json")
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	after := parsed.Query().Get("after")
	if after == "" {
		t.Fatalf("after query parameter missing from %q", got)
	}
	if _, err := time.Parse("2006-01-02", after); err != nil {
		t.Fatalf("after = %q is not a date: %v", after, err)
	}
}

func TestRedHatCSAFURLWithAfterPreservesConfiguredWindow(t *testing.T) {
	t.Parallel()

	got := redHatCSAFURLWithAfter("https://access.redhat.com/hydra/rest/securitydata/csaf.json?after=2026-01-01")
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	if after := parsed.Query().Get("after"); after != "2026-01-01" {
		t.Fatalf("after = %q, want configured date", after)
	}
}
