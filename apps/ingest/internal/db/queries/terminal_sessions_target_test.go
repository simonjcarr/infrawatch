package queries

import "testing"

func TestTerminalSSHTargetPrefersUsefulIPAddress(t *testing.T) {
	got := terminalSSHTarget("ct-ops", []string{"172.17.0.1", "192.168.1.42"})
	if got != "192.168.1.42" {
		t.Fatalf("terminalSSHTarget() = %q, want first useful IP", got)
	}
}

func TestTerminalSSHTargetFallsBackToHostname(t *testing.T) {
	got := terminalSSHTarget("ct-ops", []string{"127.0.0.1", "172.17.0.1"})
	if got != "ct-ops" {
		t.Fatalf("terminalSSHTarget() = %q, want hostname fallback", got)
	}
}

func TestTerminalSSHTargetUsesFirstIPWhenHostnameMissing(t *testing.T) {
	got := terminalSSHTarget("", []string{"127.0.0.1", "172.17.0.1"})
	if got != "127.0.0.1" {
		t.Fatalf("terminalSSHTarget() = %q, want first recorded IP fallback", got)
	}
}
