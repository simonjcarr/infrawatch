package main

import "testing"

func TestEnrolmentTokenFromEnvUsesCanonicalEnv(t *testing.T) {
	t.Setenv("CT_OPS_ENROLMENT_TOKEN", " canonical ")

	if got := enrolmentTokenFromEnv(); got != "canonical" {
		t.Fatalf("unexpected token: %q", got)
	}
}
