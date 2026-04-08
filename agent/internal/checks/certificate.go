package checks

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
)

// CertificateConfig is the JSON config for a certificate check.
type CertificateConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	ServerName string `json:"server_name,omitempty"`
	TimeoutSec int    `json:"timeout_seconds,omitempty"`
}

// CertificateReport is the structured JSON payload written to check_results.output.
type CertificateReport struct {
	Host              string       `json:"host"`
	Port              int          `json:"port"`
	ServerName        string       `json:"server_name"`
	CommonName        string       `json:"common_name"`
	Subject           string       `json:"subject"`
	Issuer            string       `json:"issuer"`
	SANs              []string     `json:"sans"`
	NotBefore         time.Time    `json:"not_before"`
	NotAfter          time.Time    `json:"not_after"`
	FingerprintSHA256 string       `json:"fingerprint_sha256"`
	SerialNumber      string       `json:"serial_number"`
	SignatureAlgo     string       `json:"signature_algorithm"`
	KeyAlgo           string       `json:"key_algorithm"`
	IsSelfSigned      bool         `json:"is_self_signed"`
	Chain             []ChainEntry `json:"chain"`
	Error             string       `json:"error,omitempty"`
}

// ChainEntry holds summary info for a single certificate in the chain.
type ChainEntry struct {
	Subject           string    `json:"subject"`
	Issuer            string    `json:"issuer"`
	NotBefore         time.Time `json:"not_before"`
	NotAfter          time.Time `json:"not_after"`
	FingerprintSHA256 string    `json:"fingerprint_sha256"`
}

func certFingerprint(cert *x509.Certificate) string {
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:])
}

func pkixNameToString(name interface{ String() string }) string {
	return name.String()
}

func keyAlgorithmLabel(cert *x509.Certificate) string {
	switch cert.PublicKeyAlgorithm {
	case x509.RSA:
		if k, ok := cert.PublicKey.(interface{ Size() int }); ok {
			return fmt.Sprintf("RSA-%d", k.Size()*8)
		}
		return "RSA"
	case x509.ECDSA:
		return "ECDSA"
	case x509.Ed25519:
		return "Ed25519"
	default:
		return cert.PublicKeyAlgorithm.String()
	}
}

func runCertificateCheck(cfg CertificateConfig) (status, output string) {
	timeout := time.Duration(cfg.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	serverName := cfg.ServerName
	if serverName == "" {
		serverName = cfg.Host
	}

	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	tlsCfg := &tls.Config{
		ServerName:         serverName,
		InsecureSkipVerify: true, //nolint:gosec // intentional: we do our own validation below
	}

	conn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: timeout},
		"tcp",
		address,
		tlsCfg,
	)
	if err != nil {
		report := CertificateReport{
			Host:       cfg.Host,
			Port:       cfg.Port,
			ServerName: serverName,
			Error:      err.Error(),
		}
		out, _ := json.Marshal(report)
		return "error", string(out)
	}
	defer conn.Close()

	peerCerts := conn.ConnectionState().PeerCertificates
	if len(peerCerts) == 0 {
		report := CertificateReport{
			Host:       cfg.Host,
			Port:       cfg.Port,
			ServerName: serverName,
			Error:      "no peer certificates returned",
		}
		out, _ := json.Marshal(report)
		return "error", string(out)
	}

	leaf := peerCerts[0]
	now := time.Now()

	// Build SANs list
	sans := make([]string, 0, len(leaf.DNSNames)+len(leaf.IPAddresses)+len(leaf.EmailAddresses)+len(leaf.URIs))
	for _, d := range leaf.DNSNames {
		sans = append(sans, "DNS:"+d)
	}
	for _, ip := range leaf.IPAddresses {
		sans = append(sans, "IP:"+ip.String())
	}
	for _, e := range leaf.EmailAddresses {
		sans = append(sans, "email:"+e)
	}
	for _, u := range leaf.URIs {
		sans = append(sans, "URI:"+u.String())
	}

	// Build chain entries
	chain := make([]ChainEntry, 0, len(peerCerts))
	for _, c := range peerCerts {
		chain = append(chain, ChainEntry{
			Subject:           c.Subject.String(),
			Issuer:            c.Issuer.String(),
			NotBefore:         c.NotBefore,
			NotAfter:          c.NotAfter,
			FingerprintSHA256: certFingerprint(c),
		})
	}

	// Common name: use Subject CN if available, otherwise first SAN
	cn := leaf.Subject.CommonName
	if cn == "" && len(leaf.DNSNames) > 0 {
		cn = leaf.DNSNames[0]
	}

	// Extract issuer common name for display
	issuerCN := leaf.Issuer.CommonName
	if issuerCN == "" {
		issuerCN = strings.TrimPrefix(leaf.Issuer.String(), "CN=")
	}

	isSelfSigned := leaf.Subject.String() == leaf.Issuer.String()

	report := CertificateReport{
		Host:              cfg.Host,
		Port:              cfg.Port,
		ServerName:        serverName,
		CommonName:        cn,
		Subject:           leaf.Subject.String(),
		Issuer:            issuerCN,
		SANs:              sans,
		NotBefore:         leaf.NotBefore,
		NotAfter:          leaf.NotAfter,
		FingerprintSHA256: certFingerprint(leaf),
		SerialNumber:      leaf.SerialNumber.String(),
		SignatureAlgo:     leaf.SignatureAlgorithm.String(),
		KeyAlgo:           keyAlgorithmLabel(leaf),
		IsSelfSigned:      isSelfSigned,
		Chain:             chain,
	}

	out, _ := json.Marshal(report)

	// Determine check status
	if now.After(leaf.NotAfter) || now.Before(leaf.NotBefore) {
		return "fail", string(out)
	}
	return "pass", string(out)
}
