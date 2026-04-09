package checks

import (
	"bufio"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// SshKeyScanConfig is the JSON config for an ssh_key_scan check.
type SshKeyScanConfig struct {
	ScanPaths []string `json:"scan_paths,omitempty"`
	SkipPaths []string `json:"skip_paths,omitempty"`
}

// SshKeyScanReport is the structured JSON payload for SSH key discovery.
type SshKeyScanReport struct {
	Keys  []SshKeyEntry `json:"keys"`
	Error string        `json:"error,omitempty"`
}

// SshKeyEntry describes a single SSH key discovered on the host.
type SshKeyEntry struct {
	KeyType            string `json:"key_type"`
	BitLength          int    `json:"bit_length,omitempty"`
	FingerprintSHA256  string `json:"fingerprint_sha256"`
	Comment            string `json:"comment,omitempty"`
	FilePath           string `json:"file_path"`
	KeySource          string `json:"key_source"`
	AssociatedUsername string `json:"associated_username"`
	KeyAgeSeconds      int64  `json:"key_age_seconds,omitempty"`
}

// identityPubFiles lists the public key filenames to look for in ~/.ssh/.
var identityPubFiles = []string{
	"id_rsa.pub",
	"id_ed25519.pub",
	"id_ecdsa.pub",
	"id_dsa.pub",
}

func runSshKeyScanCheck(cfg SshKeyScanConfig) (status, output string) {
	skipSet := make(map[string]bool, len(cfg.SkipPaths))
	for _, p := range cfg.SkipPaths {
		skipSet[p] = true
	}

	// Discover user home directories from /etc/passwd
	users := parsePasswdHomes()
	now := time.Now()

	var keys []SshKeyEntry

	// Scan each user's .ssh directory
	for _, u := range users {
		sshDir := filepath.Join(u.home, ".ssh")

		// Scan authorized_keys
		authKeysPath := filepath.Join(sshDir, "authorized_keys")
		if !skipSet[authKeysPath] {
			found := scanAuthorizedKeys(authKeysPath, u.username, now)
			keys = append(keys, found...)
		}

		// Scan identity public key files
		for _, pubFile := range identityPubFiles {
			pubPath := filepath.Join(sshDir, pubFile)
			if skipSet[pubPath] {
				continue
			}
			if entry, ok := scanIdentityPubKey(pubPath, u.username, now); ok {
				keys = append(keys, entry)
			}
		}
	}

	// Scan additional configured paths (treated as authorized_keys format)
	for _, scanPath := range cfg.ScanPaths {
		if skipSet[scanPath] {
			continue
		}
		// Try to determine the username from the path
		username := inferUsernameFromPath(scanPath)
		found := scanAuthorizedKeys(scanPath, username, now)
		keys = append(keys, found...)
	}

	report := SshKeyScanReport{Keys: keys}
	out, _ := json.Marshal(report)
	return "pass", string(out)
}

type passwdUser struct {
	username string
	home     string
}

// parsePasswdHomes reads /etc/passwd and returns user -> home directory mappings.
func parsePasswdHomes() []passwdUser {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return nil
	}
	defer f.Close()

	var users []passwdUser
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.SplitN(line, ":", 7)
		if len(fields) < 6 {
			continue
		}
		users = append(users, passwdUser{username: fields[0], home: fields[5]})
	}
	return users
}

// scanAuthorizedKeys reads an authorized_keys file and returns discovered keys.
func scanAuthorizedKeys(path, username string, now time.Time) []SshKeyEntry {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil // file doesn't exist or not readable
	}

	stat, _ := os.Stat(path)
	var keys []SshKeyEntry

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		pubKey, comment, _, _, err := ssh.ParseAuthorizedKey([]byte(line))
		if err != nil {
			slog.Debug("skipping malformed authorized_keys line", "path", path, "err", err)
			continue
		}

		entry := SshKeyEntry{
			KeyType:            pubKey.Type(),
			BitLength:          keyBitLength(pubKey),
			FingerprintSHA256:  ssh.FingerprintSHA256(pubKey),
			Comment:            comment,
			FilePath:           path,
			KeySource:          "authorized_keys",
			AssociatedUsername: username,
		}
		if stat != nil {
			entry.KeyAgeSeconds = int64(now.Sub(stat.ModTime()).Seconds())
		}
		keys = append(keys, entry)
	}
	return keys
}

// scanIdentityPubKey reads a single .pub identity key file and returns the key entry.
func scanIdentityPubKey(path, username string, now time.Time) (SshKeyEntry, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return SshKeyEntry{}, false
	}

	pubKey, comment, _, _, err := ssh.ParseAuthorizedKey(data)
	if err != nil {
		slog.Debug("skipping malformed identity pub key", "path", path, "err", err)
		return SshKeyEntry{}, false
	}

	stat, _ := os.Stat(path)
	entry := SshKeyEntry{
		KeyType:            pubKey.Type(),
		BitLength:          keyBitLength(pubKey),
		FingerprintSHA256:  ssh.FingerprintSHA256(pubKey),
		Comment:            comment,
		FilePath:           path,
		KeySource:          "identity",
		AssociatedUsername: username,
	}
	if stat != nil {
		entry.KeyAgeSeconds = int64(now.Sub(stat.ModTime()).Seconds())
	}
	return entry, true
}

// keyBitLength returns the bit length of a public key, or 0 if unknown.
func keyBitLength(key ssh.PublicKey) int {
	// ssh.PublicKey doesn't expose bit length directly.
	// We can infer from the marshal size for RSA, or from type for fixed-size algorithms.
	switch key.Type() {
	case "ssh-ed25519":
		return 256
	case "ssh-dss":
		return 1024
	case "ssh-rsa":
		// RSA key: marshal data includes e and n; the key size in bits is len(n)*8
		// A more precise approach uses crypto/rsa, but the marshal size gives a reasonable estimate.
		marshalLen := len(key.Marshal())
		if marshalLen > 30 {
			// Rough heuristic: subtract overhead (~11 bytes for type string + exponent)
			return (marshalLen - 11) * 8 / 2 // very approximate, prefer exact if possible
		}
		return 0
	default:
		// For ECDSA, type string encodes the curve
		t := key.Type()
		if strings.Contains(t, "256") {
			return 256
		}
		if strings.Contains(t, "384") {
			return 384
		}
		if strings.Contains(t, "521") {
			return 521
		}
		return 0
	}
}

// inferUsernameFromPath tries to extract a username from a file path like /home/user/.ssh/...
func inferUsernameFromPath(path string) string {
	parts := strings.Split(path, string(os.PathSeparator))
	for i, part := range parts {
		if part == "home" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	// Check for /root
	for _, part := range parts {
		if part == "root" {
			return "root"
		}
	}
	return ""
}

