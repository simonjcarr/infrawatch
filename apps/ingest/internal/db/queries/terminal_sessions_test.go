package queries

import (
	"errors"
	"testing"
	"time"
)

func TestVerifySSHHostKeyFingerprintRejectsUnpinnedHosts(t *testing.T) {
	tests := []struct {
		name    string
		current *string
	}{
		{name: "missing fingerprint"},
		{name: "empty fingerprint", current: ptr("")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := verifySSHHostKeyFingerprint(tt.current, "SHA256:presented")
			if !errors.Is(err, ErrSSHHostKeyNotTrusted) {
				t.Fatalf("verifySSHHostKeyFingerprint() error = %v, want ErrSSHHostKeyNotTrusted", err)
			}
		})
	}
}

func TestVerifySSHHostKeyFingerprintRejectsMismatch(t *testing.T) {
	err := verifySSHHostKeyFingerprint(ptr("SHA256:pinned"), "SHA256:presented")
	if !errors.Is(err, ErrSSHHostKeyMismatch) {
		t.Fatalf("verifySSHHostKeyFingerprint() error = %v, want ErrSSHHostKeyMismatch", err)
	}
}

func TestVerifySSHHostKeyFingerprintAllowsPinnedMatch(t *testing.T) {
	if err := verifySSHHostKeyFingerprint(ptr("SHA256:pinned"), "SHA256:pinned"); err != nil {
		t.Fatalf("verifySSHHostKeyFingerprint() error = %v, want nil", err)
	}
}

func TestVerifySSHHostKeyMetadataAllowsTrustedListMatch(t *testing.T) {
	metadata := []byte(`{
		"sshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:ed25519"},
			{"algorithm": "ecdsa-sha2-nistp256", "fingerprintSha256": "SHA256:ecdsa"}
		]
	}`)

	if err := verifySSHHostKeyMetadata(metadata, "SHA256:ecdsa"); err != nil {
		t.Fatalf("verifySSHHostKeyMetadata() error = %v, want nil", err)
	}
}

func TestVerifySSHHostKeyMetadataRejectsTrustedListMismatch(t *testing.T) {
	metadata := []byte(`{
		"sshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:ed25519"}
		],
		"pendingSshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:new"}
		]
	}`)

	err := verifySSHHostKeyMetadata(metadata, "SHA256:new")
	if !errors.Is(err, ErrSSHHostKeyMismatch) {
		t.Fatalf("verifySSHHostKeyMetadata() error = %v, want ErrSSHHostKeyMismatch", err)
	}
}

func TestVerifySSHHostKeyMetadataBlocksWhenPendingChangeExists(t *testing.T) {
	metadata := []byte(`{
		"sshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:old"}
		],
		"pendingSshHostKeys": [
			{"algorithm": "ssh-ed25519", "fingerprintSha256": "SHA256:new"}
		],
		"sshHostKeyStatus": "changed"
	}`)

	err := verifySSHHostKeyMetadata(metadata, "SHA256:old")
	if !errors.Is(err, ErrSSHHostKeyMismatch) {
		t.Fatalf("verifySSHHostKeyMetadata() error = %v, want ErrSSHHostKeyMismatch", err)
	}
}

func TestTerminalAuthThrottleKeysIncludeUserHostUsernameAndSource(t *testing.T) {
	info := TerminalSessionInfo{
		OrganisationID: "org-1",
		UserID:         "user-1",
		HostID:         "host-1",
		Username:       "Admin",
	}

	keys := terminalAuthThrottleKeys(info, "203.0.113.10")
	if len(keys) != 2 {
		t.Fatalf("terminalAuthThrottleKeys() length = %d, want 2", len(keys))
	}

	byScope := map[string]string{}
	for _, key := range keys {
		byScope[key.scope] = key.key
	}
	userKey := byScope["terminal:ssh:user-host-username"]
	sourceKey := byScope["terminal:ssh:source-host-username"]
	if userKey == "" {
		t.Fatal("missing user-host-username throttle key")
	}
	if sourceKey == "" {
		t.Fatal("missing source-host-username throttle key")
	}
	if userKey == sourceKey {
		t.Fatal("expected distinct throttle keys for user and source scopes")
	}
}

func TestTerminalAuthThrottleKeyNormalisesUsernameAndSource(t *testing.T) {
	base := TerminalSessionInfo{
		OrganisationID: "org-1",
		UserID:         "user-1",
		HostID:         "host-1",
		Username:       "Admin",
	}
	upper := terminalAuthThrottleKeys(base, "203.0.113.10:49152")

	base.Username = " admin "
	lower := terminalAuthThrottleKeys(base, "203.0.113.10")

	upperByScope := map[string]string{}
	lowerByScope := map[string]string{}
	for _, key := range upper {
		upperByScope[key.scope] = key.key
	}
	for _, key := range lower {
		lowerByScope[key.scope] = key.key
	}

	if upperByScope["terminal:ssh:user-host-username"] != lowerByScope["terminal:ssh:user-host-username"] {
		t.Fatal("expected username case/space differences to map to the same user throttle key")
	}
	if upperByScope["terminal:ssh:source-host-username"] != lowerByScope["terminal:ssh:source-host-username"] {
		t.Fatal("expected source host/port differences to map to the same source throttle key")
	}
}

func TestApplyTerminalAuthFailureLocksAfterLimit(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	state := terminalAuthThrottleState{}

	var status TerminalAuthThrottleStatus
	for i := 0; i < terminalAuthMaxFailures; i++ {
		status = applyTerminalAuthFailure(state, now)
		state = status.state
	}

	if status.Allowed {
		t.Fatal("expected terminal auth throttle to block after max failures")
	}
	if status.RetryAfter <= 0 {
		t.Fatalf("RetryAfter = %v, want positive duration", status.RetryAfter)
	}
	if len(state.hits) != 0 {
		t.Fatalf("state.hits length = %d, want reset after lockout", len(state.hits))
	}
	if state.lockoutLevel != 1 {
		t.Fatalf("state.lockoutLevel = %d, want 1", state.lockoutLevel)
	}
	if !state.lockedUntil.After(now) {
		t.Fatalf("state.lockedUntil = %v, want after %v", state.lockedUntil, now)
	}
}

func TestTerminalAuthLockoutDurationCapsAtMaximum(t *testing.T) {
	if got := terminalAuthLockoutDuration(32); got != terminalAuthMaxLockout {
		t.Fatalf("terminalAuthLockoutDuration(32) = %v, want %v", got, terminalAuthMaxLockout)
	}
}

func TestApplyTerminalAuthCheckPrunesExpiredLockout(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	state := terminalAuthThrottleState{
		hits:         []time.Time{now.Add(-terminalAuthWindow - time.Second), now.Add(-time.Minute)},
		lockoutLevel: 1,
		lockedUntil:  now.Add(-time.Second),
	}

	status := applyTerminalAuthCheck(state, now)
	if !status.Allowed {
		t.Fatal("expected expired lockout to allow a new attempt")
	}
	if len(status.state.hits) != 1 {
		t.Fatalf("pruned hits length = %d, want 1", len(status.state.hits))
	}
	if !status.state.lockedUntil.IsZero() {
		t.Fatalf("lockedUntil = %v, want zero after expiry", status.state.lockedUntil)
	}
}

func ptr(value string) *string {
	return &value
}
