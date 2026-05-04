package handlers

import "testing"

func TestAssertPublicHTTPURLRejectsPrivateTargets(t *testing.T) {
	if err := assertPublicHTTPURL("https://127.0.0.1/webhook"); err == nil {
		t.Fatal("expected private IPv4 webhook target to be rejected")
	}
	if err := assertPublicHTTPURL("https://[::1]/webhook"); err == nil {
		t.Fatal("expected private IPv6 webhook target to be rejected")
	}
}

func TestAssertPublicHTTPURLAllowsPublicTargets(t *testing.T) {
	if err := assertPublicHTTPURL("https://8.8.8.8/webhook"); err != nil {
		t.Fatalf("expected public webhook target to be allowed: %v", err)
	}
}

func TestAssertPublicHostRejectsPrivateTargets(t *testing.T) {
	if err := assertPublicHost("127.0.0.1"); err == nil {
		t.Fatal("expected private smtp host to be rejected")
	}
	if err := assertPublicHost("::1"); err == nil {
		t.Fatal("expected private IPv6 smtp host to be rejected")
	}
}

func TestAssertPublicHostAllowsPublicTargets(t *testing.T) {
	if err := assertPublicHost("8.8.8.8"); err != nil {
		t.Fatalf("expected public smtp host to be allowed: %v", err)
	}
}
