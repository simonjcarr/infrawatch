package handlers

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestTerminalWSAcceptOptionsDefaultToSameOrigin(t *testing.T) {
	opts, err := terminalWSAcceptOptions(nil)
	if err != nil {
		t.Fatalf("terminalWSAcceptOptions(nil) error = %v", err)
	}
	if opts.InsecureSkipVerify {
		t.Fatal("expected same-origin default to keep origin verification enabled")
	}
	if len(opts.OriginPatterns) != 0 {
		t.Fatalf("opts.OriginPatterns = %#v, want none", opts.OriginPatterns)
	}
}

func TestTerminalWSAcceptOptionsAllowConfiguredOrigins(t *testing.T) {
	opts, err := terminalWSAcceptOptions([]string{
		"https://app.example.com",
		"http://localhost:3000",
	})
	if err != nil {
		t.Fatalf("terminalWSAcceptOptions() error = %v", err)
	}

	want := []string{"https://app.example.com", "http://localhost:3000"}
	if !reflect.DeepEqual(opts.OriginPatterns, want) {
		t.Fatalf("opts.OriginPatterns = %#v, want %#v", opts.OriginPatterns, want)
	}
}

func TestTerminalWSAcceptOptionsRejectInvalidOrigins(t *testing.T) {
	if _, err := terminalWSAcceptOptions([]string{"not-a-url"}); err == nil {
		t.Fatal("expected invalid origin to be rejected")
	}
}

func TestTerminalRemoteAddrNormalisesHostPort(t *testing.T) {
	if got := terminalRemoteAddr("203.0.113.10:49152"); got != "203.0.113.10" {
		t.Fatalf("terminalRemoteAddr() = %q, want source IP", got)
	}
	if got := terminalRemoteAddr("[2001:db8::1]:49152"); got != "2001:db8::1" {
		t.Fatalf("terminalRemoteAddr() = %q, want IPv6 source", got)
	}
}

func TestIsSSHAuthenticationFailure(t *testing.T) {
	if !isSSHAuthenticationFailure(&ssh.ServerAuthError{}) {
		t.Fatal("expected ssh.ServerAuthError to count as an authentication failure")
	}
	if isSSHAuthenticationFailure(errors.New("network unreachable")) {
		t.Fatal("expected generic network errors not to count as authentication failures")
	}
}

func TestInsecureSkipVerifyTrueAllowlist(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller(0) failed")
	}

	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))
	allowed := map[string]struct{}{
		filepath.Join(repoRoot, "agent", "internal", "checks", "certificate.go"): {},
	}

	var unexpected []string
	err := filepath.WalkDir(repoRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", ".worktrees", "node_modules":
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !strings.Contains(string(data), "InsecureSkipVerify: true") {
			return nil
		}
		if _, ok := allowed[path]; ok {
			return nil
		}
		unexpected = append(unexpected, path)
		return nil
	})
	if err != nil {
		t.Fatalf("WalkDir() error = %v", err)
	}
	if len(unexpected) != 0 {
		t.Fatalf("found unexpected InsecureSkipVerify: true call sites: %v", unexpected)
	}
}
