package identity

import (
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	certFile   = "agent_cert.pem"
	caCertFile = "agent_ca.pem"
)

// LoadClientCert returns the agent's saved client cert PEM + the parsed
// certificate metadata. Returns (nil, nil, nil) if no cert is on disk yet.
func LoadClientCert(dataDir string) ([]byte, *x509.Certificate, error) {
	path := filepath.Join(dataDir, certFile)
	pemBytes, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("reading cert: %w", err)
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, nil, errors.New("no PEM block in cert file")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("parsing cert: %w", err)
	}
	return pemBytes, cert, nil
}

// SaveClientCert writes the cert PEM atomically (temp file + rename) with
// 0o600 permissions. Must be called with the PEM the server signed against
// the agent's current keypair. No-op when dataDir is empty (used by the
// load tester which has no persistent agent identity).
func SaveClientCert(dataDir string, certPEM []byte) error {
	if dataDir == "" {
		return nil
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	final := filepath.Join(dataDir, certFile)
	tmp := final + ".tmp"
	if err := os.WriteFile(tmp, certPEM, 0o600); err != nil {
		return fmt.Errorf("writing cert tmp: %w", err)
	}
	if err := os.Rename(tmp, final); err != nil {
		return fmt.Errorf("renaming cert: %w", err)
	}
	return nil
}

// SaveAgentCA writes the server-provided agent CA bundle PEM (0o600). Used
// for display/verification only — the agent does not validate its own cert
// against this CA (the server is the authority). No-op when caPEM or
// dataDir is empty.
func SaveAgentCA(dataDir string, caPEM []byte) error {
	if dataDir == "" || len(caPEM) == 0 {
		return nil
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dataDir, caCertFile), caPEM, 0o600)
}

// ShouldRenew returns true when now falls inside the renewal window (last
// one-third of validity). Leaf certs are issued with 90d validity so renewal
// kicks in around day 60.
func ShouldRenew(cert *x509.Certificate, now time.Time) bool {
	if cert == nil {
		return false
	}
	total := cert.NotAfter.Sub(cert.NotBefore)
	if total <= 0 {
		return true
	}
	window := total / 3
	return cert.NotAfter.Sub(now) < window
}

// TLSCertificate returns a tls.Certificate assembled from the on-disk leaf
// PEM and the agent's Ed25519 private key. The caller must have loaded the
// keypair via LoadOrGenerate.
func (k *Keypair) TLSCertificate(dataDir string) (*tls.Certificate, error) {
	certPath := filepath.Join(dataDir, certFile)
	pemBytes, err := os.ReadFile(certPath)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading cert: %w", err)
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("no PEM block in cert file")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing cert: %w", err)
	}
	// Sanity: the cert's public key must match our key.
	pub, ok := cert.PublicKey.(ed25519.PublicKey)
	if !ok || !ed25519.PublicKey(k.PublicKey).Equal(pub) {
		return nil, errors.New("cert public key does not match agent keypair")
	}
	return &tls.Certificate{
		Certificate: [][]byte{block.Bytes},
		PrivateKey:  k.PrivateKey,
		Leaf:        cert,
	}, nil
}
