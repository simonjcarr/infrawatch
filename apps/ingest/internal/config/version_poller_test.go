package config

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAgentReleasesURLUsesCanonicalRepository(t *testing.T) {
	t.Parallel()

	if !strings.Contains(agentReleasesURL, "github.com/repos/carrtech-dev/ct-ops/") {
		t.Fatalf("agentReleasesURL = %q, want canonical carrtech-dev/ct-ops repository", agentReleasesURL)
	}
}

func TestLatestAgentVersionFromGitHubReleases(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "application/vnd.github+json" {
			t.Errorf("Accept header = %q, want GitHub JSON media type", got)
		}
		fmt.Fprint(w, `[
			{"tag_name":"web/v0.75.4"},
			{"tag_name":"agent/v0.31.0"},
			{"tag_name":"agent/v0.30.8"}
		]`)
	}))
	defer server.Close()

	got, err := latestAgentVersionFromGitHub(context.Background(), server.URL, "")
	if err != nil {
		t.Fatalf("latestAgentVersionFromGitHub: %v", err)
	}
	if got != "v0.31.0" {
		t.Fatalf("latestAgentVersionFromGitHub = %q, want %q", got, "v0.31.0")
	}
}

func TestLatestAgentVersionFromGitHubUsesToken(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("Authorization header = %q, want bearer token", got)
		}
		fmt.Fprint(w, `[{"tag_name":"agent/v0.31.0"}]`)
	}))
	defer server.Close()

	got, err := latestAgentVersionFromGitHub(context.Background(), server.URL, "test-token")
	if err != nil {
		t.Fatalf("latestAgentVersionFromGitHub: %v", err)
	}
	if got != "v0.31.0" {
		t.Fatalf("latestAgentVersionFromGitHub = %q, want %q", got, "v0.31.0")
	}
}

func TestCandidateVersionDoesNotDowngradeCurrent(t *testing.T) {
	t.Parallel()

	if shouldStoreCandidateVersion("v0.31.0", "v0.30.8") {
		t.Fatal("older manifest fallback should not downgrade a newer current version")
	}
	if !shouldStoreCandidateVersion("v0.30.8", "v0.31.0") {
		t.Fatal("newer discovered release should update the current version")
	}
}
