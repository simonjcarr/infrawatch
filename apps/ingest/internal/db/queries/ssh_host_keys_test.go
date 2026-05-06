package queries

import "testing"

func TestApplyReportedSSHHostKeysAutoTrustsFirstReport(t *testing.T) {
	current := []byte(`{"terminalEnabled": true}`)
	reported := []SSHHostKey{
		{Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:ed25519"},
		{Algorithm: "ecdsa-sha2-nistp256", FingerprintSHA256: "SHA256:ecdsa"},
	}

	next, changed, err := applyReportedSSHHostKeys(current, reported)
	if err != nil {
		t.Fatalf("applyReportedSSHHostKeys() error = %v", err)
	}
	if !changed {
		t.Fatalf("applyReportedSSHHostKeys() changed = false, want true")
	}
	if next.SSHHostKeySha256 != "SHA256:ed25519" {
		t.Fatalf("legacy fingerprint = %q, want SHA256:ed25519", next.SSHHostKeySha256)
	}
	if len(next.SSHHostKeys) != 2 {
		t.Fatalf("trusted keys len = %d, want 2", len(next.SSHHostKeys))
	}
	if len(next.PendingSSHHostKeys) != 0 {
		t.Fatalf("pending keys len = %d, want 0", len(next.PendingSSHHostKeys))
	}
	if next.SSHHostKeyStatus != "" {
		t.Fatalf("status = %q, want empty", next.SSHHostKeyStatus)
	}
	if next.Extra["terminalEnabled"] != true {
		t.Fatalf("terminalEnabled metadata was not preserved")
	}
}

func TestApplyReportedSSHHostKeysStoresChangedKeysAsPending(t *testing.T) {
	current := []byte(`{
		"sshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:old"}
		]
	}`)
	reported := []SSHHostKey{
		{Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:new"},
	}

	next, changed, err := applyReportedSSHHostKeys(current, reported)
	if err != nil {
		t.Fatalf("applyReportedSSHHostKeys() error = %v", err)
	}
	if !changed {
		t.Fatalf("applyReportedSSHHostKeys() changed = false, want true")
	}
	if got := next.SSHHostKeys[0].FingerprintSHA256; got != "SHA256:old" {
		t.Fatalf("trusted fingerprint = %q, want SHA256:old", got)
	}
	if len(next.PendingSSHHostKeys) != 1 || next.PendingSSHHostKeys[0].FingerprintSHA256 != "SHA256:new" {
		t.Fatalf("pending keys = %#v, want SHA256:new", next.PendingSSHHostKeys)
	}
	if next.SSHHostKeyStatus != "changed" {
		t.Fatalf("status = %q, want changed", next.SSHHostKeyStatus)
	}
	if next.SSHHostKeyChangedAt == "" {
		t.Fatalf("changed timestamp was not set")
	}
}

func TestApplyReportedSSHHostKeysKeepsLegacyFingerprintTrusted(t *testing.T) {
	current := []byte(`{"sshHostKeySha256": "SHA256:legacy"}`)
	reported := []SSHHostKey{
		{Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:legacy"},
	}

	next, changed, err := applyReportedSSHHostKeys(current, reported)
	if err != nil {
		t.Fatalf("applyReportedSSHHostKeys() error = %v", err)
	}
	if changed {
		t.Fatalf("applyReportedSSHHostKeys() changed = true, want false")
	}
	if len(next.PendingSSHHostKeys) != 0 {
		t.Fatalf("pending keys len = %d, want 0", len(next.PendingSSHHostKeys))
	}
}

func TestAcceptPendingSSHHostKeysPromotesPendingKeys(t *testing.T) {
	current := []byte(`{
		"sshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:old"}
		],
		"pendingSshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:new"}
		],
		"sshHostKeyStatus": "changed",
		"sshHostKeyChangedAt": "2026-05-06T20:00:00Z"
	}`)

	next, err := acceptPendingSSHHostKeysMetadata(current)
	if err != nil {
		t.Fatalf("acceptPendingSSHHostKeysMetadata() error = %v", err)
	}
	if len(next.SSHHostKeys) != 1 || next.SSHHostKeys[0].FingerprintSHA256 != "SHA256:new" {
		t.Fatalf("trusted keys = %#v, want SHA256:new", next.SSHHostKeys)
	}
	if next.SSHHostKeySha256 != "SHA256:new" {
		t.Fatalf("legacy fingerprint = %q, want SHA256:new", next.SSHHostKeySha256)
	}
	if len(next.PendingSSHHostKeys) != 0 {
		t.Fatalf("pending keys len = %d, want 0", len(next.PendingSSHHostKeys))
	}
	if next.SSHHostKeyStatus != "" {
		t.Fatalf("status = %q, want empty", next.SSHHostKeyStatus)
	}
}
