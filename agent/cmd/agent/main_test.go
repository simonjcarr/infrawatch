package main

import "testing"

func TestEnrolmentTokenFromEnvUsesCanonicalEnv(t *testing.T) {
	t.Setenv("CT_OPS_ENROLMENT_TOKEN", " canonical ")
	t.Setenv("CT_OPS_ORG_TOKEN", "legacy")

	if got := enrolmentTokenFromEnv(); got != "canonical" {
		t.Fatalf("unexpected token: %q", got)
	}
}

func TestEnrolmentTokenFromEnvFallsBackToLegacyOrgEnv(t *testing.T) {
	t.Setenv("CT_OPS_ORG_TOKEN", " legacy ")

	if got := enrolmentTokenFromEnv(); got != "legacy" {
		t.Fatalf("unexpected token: %q", got)
	}
}
