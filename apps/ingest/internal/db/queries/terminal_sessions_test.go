package queries

import (
	"errors"
	"testing"
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

func ptr(value string) *string {
	return &value
}
