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

func ptr(value string) *string {
	return &value
}
