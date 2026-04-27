package checks

import (
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"os"
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	"golang.org/x/crypto/pkcs12"
)

// CertFileConfig is the JSON config for a cert_file check.
type CertFileConfig struct {
	FilePath string `json:"file_path"`
	Format   string `json:"format"`             // "pem" | "pkcs12" | "jks"
	Password string `json:"password,omitempty"` // for pkcs12/jks
	Alias    string `json:"alias,omitempty"`    // jks only: specific entry; empty = first cert entry
}

// CertFileReport is the JSON payload written to check_results.output for a cert_file check.
// It shares the same field names as CertificateReport so the web UI helper can parse both.
type CertFileReport struct {
	FilePath          string    `json:"file_path"`
	Format            string    `json:"format"`
	CommonName        string    `json:"common_name"`
	Subject           string    `json:"subject"`
	Issuer            string    `json:"issuer"`
	SANs              []string  `json:"sans"`
	NotBefore         time.Time `json:"not_before"`
	NotAfter          time.Time `json:"not_after"`
	FingerprintSHA256 string    `json:"fingerprint_sha256"`
	SerialNumber      string    `json:"serial_number"`
	SignatureAlgo     string    `json:"signature_algorithm"`
	KeyAlgo           string    `json:"key_algorithm"`
	IsSelfSigned      bool      `json:"is_self_signed"`
	Error             string    `json:"error,omitempty"`
}

func runCertFileCheck(cfg CertFileConfig) (status, output string) {
	cert, err := loadCert(cfg)
	if err != nil {
		report := CertFileReport{FilePath: cfg.FilePath, Format: cfg.Format, Error: err.Error()}
		out, _ := json.Marshal(report)
		return "error", string(out)
	}

	sans := buildSANs(cert)

	cn := cert.Subject.CommonName
	if cn == "" && len(cert.DNSNames) > 0 {
		cn = cert.DNSNames[0]
	}

	isSelfSigned := cert.Subject.String() == cert.Issuer.String()

	issuerCN := cert.Issuer.CommonName
	if issuerCN == "" {
		issuerCN = cert.Issuer.String()
	}

	sum := sha256.Sum256(cert.Raw)
	fingerprint := hex.EncodeToString(sum[:])

	report := CertFileReport{
		FilePath:          cfg.FilePath,
		Format:            cfg.Format,
		CommonName:        cn,
		Subject:           cert.Subject.String(),
		Issuer:            issuerCN,
		SANs:              sans,
		NotBefore:         cert.NotBefore,
		NotAfter:          cert.NotAfter,
		FingerprintSHA256: fingerprint,
		SerialNumber:      cert.SerialNumber.String(),
		SignatureAlgo:     cert.SignatureAlgorithm.String(),
		KeyAlgo:           keyAlgorithmLabel(cert),
		IsSelfSigned:      isSelfSigned,
	}

	out, _ := json.Marshal(report)

	now := time.Now()
	if now.After(cert.NotAfter) || now.Before(cert.NotBefore) {
		return "fail", string(out)
	}
	return "pass", string(out)
}

// loadCert reads the file and returns the leaf certificate based on the configured format.
func loadCert(cfg CertFileConfig) (*x509.Certificate, error) {
	info, err := os.Lstat(cfg.FilePath)
	if err != nil {
		return nil, fmt.Errorf("cannot stat file: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("symlinked certificate files are not allowed")
	}

	data, err := os.ReadFile(cfg.FilePath)
	if err != nil {
		return nil, fmt.Errorf("cannot read file: %w", err)
	}

	switch cfg.Format {
	case "pem":
		return loadPEM(data)
	case "pkcs12":
		return loadPKCS12(data, cfg.Password)
	case "jks":
		return loadJKS(data, cfg.Password, cfg.Alias)
	default:
		return nil, fmt.Errorf("unknown format %q; expected pem, pkcs12, or jks", cfg.Format)
	}
}

func loadPEM(data []byte) (*x509.Certificate, error) {
	for {
		var block *pem.Block
		block, data = pem.Decode(data)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse PEM certificate: %w", err)
		}
		return cert, nil
	}
	return nil, fmt.Errorf("no CERTIFICATE block found in PEM file")
}

func loadPKCS12(data []byte, password string) (*x509.Certificate, error) {
	_, cert, err := pkcs12.Decode(data, password)
	if err != nil {
		return nil, fmt.Errorf("decode PKCS#12: %w", err)
	}
	return cert, nil
}

func loadJKS(data []byte, password, alias string) (*x509.Certificate, error) {
	ks := keystore.New()
	if err := ks.Load(bytes.NewReader(data), []byte(password)); err != nil {
		return nil, fmt.Errorf("parse JKS: %w", err)
	}

	// If an alias is specified, look for it directly.
	if alias != "" {
		return jksCertForAlias(ks, alias)
	}

	// Otherwise use the first trusted certificate entry.
	for _, a := range ks.Aliases() {
		if ks.IsTrustedCertificateEntry(a) {
			return jksCertForAlias(ks, a)
		}
	}
	// Fall back to the first private key entry's certificate chain.
	for _, a := range ks.Aliases() {
		if ks.IsPrivateKeyEntry(a) {
			entry, err := ks.GetPrivateKeyEntry(a, []byte(password))
			if err != nil || len(entry.CertificateChain) == 0 {
				continue
			}
			return x509.ParseCertificate(entry.CertificateChain[0].Content)
		}
	}

	return nil, fmt.Errorf("no certificate entry found in JKS keystore")
}

func jksCertForAlias(ks keystore.KeyStore, alias string) (*x509.Certificate, error) {
	if ks.IsTrustedCertificateEntry(alias) {
		entry, err := ks.GetTrustedCertificateEntry(alias)
		if err != nil {
			return nil, fmt.Errorf("get JKS trusted cert %q: %w", alias, err)
		}
		return x509.ParseCertificate(entry.Certificate.Content)
	}
	return nil, fmt.Errorf("alias %q not found or is not a trusted certificate entry", alias)
}

func buildSANs(cert *x509.Certificate) []string {
	sans := make([]string, 0, len(cert.DNSNames)+len(cert.IPAddresses)+len(cert.EmailAddresses)+len(cert.URIs))
	for _, d := range cert.DNSNames {
		sans = append(sans, "DNS:"+d)
	}
	for _, ip := range cert.IPAddresses {
		sans = append(sans, "IP:"+ip.String())
	}
	for _, e := range cert.EmailAddresses {
		sans = append(sans, "email:"+e)
	}
	for _, u := range cert.URIs {
		sans = append(sans, "URI:"+u.String())
	}
	return sans
}
