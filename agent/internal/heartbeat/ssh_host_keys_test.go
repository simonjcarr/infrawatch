package heartbeat

import (
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestCollectSSHHostKeysFromDirReadsPublicHostKeys(t *testing.T) {
	dir := t.TempDir()
	_, public, err := generateTestSigner()
	if err != nil {
		t.Fatalf("generateTestSigner: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ssh_host_ed25519_key.pub"), ssh.MarshalAuthorizedKey(public), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "not_a_host_key.pub"), ssh.MarshalAuthorizedKey(public), 0o644); err != nil {
		t.Fatalf("WriteFile ignored key: %v", err)
	}

	keys, err := collectSSHHostKeysFromDir(dir)
	if err != nil {
		t.Fatalf("collectSSHHostKeysFromDir() error = %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("keys len = %d, want 1", len(keys))
	}
	if keys[0].Algorithm != public.Type() {
		t.Fatalf("algorithm = %q, want %q", keys[0].Algorithm, public.Type())
	}
	if keys[0].FingerprintSha256 != ssh.FingerprintSHA256(public) {
		t.Fatalf("fingerprint = %q, want %q", keys[0].FingerprintSha256, ssh.FingerprintSHA256(public))
	}
}

func generateTestSigner() (ssh.Signer, ssh.PublicKey, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return nil, nil, err
	}
	public, err := ssh.NewPublicKey(pub)
	if err != nil {
		return nil, nil, err
	}
	return signer, public, nil
}
