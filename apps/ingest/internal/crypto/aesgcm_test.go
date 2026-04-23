package ctcrypto

import (
	"bytes"
	"os"
	"testing"
)

func withSecret(t *testing.T, secret string) {
	t.Helper()
	t.Setenv("LDAP_ENCRYPTION_KEY", secret)
}

func TestRoundTrip(t *testing.T) {
	withSecret(t, "test-secret-value-1234567890")
	pt := []byte("hello, mTLS world")
	blob, err := Encrypt(pt)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	out, err := Decrypt(blob)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(pt, out) {
		t.Fatalf("round-trip mismatch: got %q want %q", out, pt)
	}
}

func TestDecryptWithWrongSecret(t *testing.T) {
	withSecret(t, "secret-A")
	blob, err := Encrypt([]byte("payload"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	withSecret(t, "secret-B")
	if _, err := Decrypt(blob); err == nil {
		t.Fatal("expected decrypt to fail with wrong secret, got nil")
	}
}

func TestBetterAuthFallback(t *testing.T) {
	t.Setenv("LDAP_ENCRYPTION_KEY", "")
	t.Setenv("BETTER_AUTH_SECRET", "fallback-secret")
	if _, err := Encrypt([]byte("x")); err != nil {
		t.Fatalf("encrypt with BETTER_AUTH_SECRET fallback: %v", err)
	}
}

func TestNoSecret(t *testing.T) {
	// Have to unset both. t.Setenv will restore after the test.
	_ = os.Unsetenv("LDAP_ENCRYPTION_KEY")
	_ = os.Unsetenv("BETTER_AUTH_SECRET")
	if _, err := Encrypt([]byte("x")); err == nil {
		t.Fatal("expected error when no secret is set")
	}
}
