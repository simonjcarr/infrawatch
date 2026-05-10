package pki

import (
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"time"
)

const (
	LeafValidity    = 90 * 24 * time.Hour // 90 days
	RenewalWindow   = 30 * 24 * time.Hour // renew at 30d remaining (~1/3 of life)
	spiffeScheme    = "spiffe"
	spiffeAuthority = "ct-ops"
)

// SignedLeaf is the result of signing a CSR.
type SignedLeaf struct {
	PEM      []byte
	Serial   string
	NotAfter time.Time
}

// Sign verifies a PKCS#10 CSR (DER-encoded) and issues a short-lived client
// cert bound to the given agent via a SPIFFE-style URI SAN.
func (a *AgentCA) Sign(csrDER []byte, agentID string) (*SignedLeaf, error) {
	if agentID == "" {
		return nil, errors.New("agentID is required")
	}
	csr, err := x509.ParseCertificateRequest(csrDER)
	if err != nil {
		return nil, fmt.Errorf("parsing CSR: %w", err)
	}
	if err := csr.CheckSignature(); err != nil {
		return nil, fmt.Errorf("CSR signature invalid: %w", err)
	}

	serialInt, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return nil, err
	}

	spiffeURI := &url.URL{
		Scheme: spiffeScheme,
		Host:   spiffeAuthority,
		Path:   fmt.Sprintf("/agent/%s", agentID),
	}

	now := time.Now().UTC()
	tmpl := &x509.Certificate{
		SerialNumber: serialInt,
		Subject: pkix.Name{
			CommonName: agentID,
		},
		NotBefore:             now.Add(-1 * time.Minute),
		NotAfter:              now.Add(LeafValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
		IsCA:                  false,
		URIs:                  []*url.URL{spiffeURI},
	}

	der, err := x509.CreateCertificate(rand.Reader, tmpl, a.Cert, csr.PublicKey, a.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("signing cert: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return &SignedLeaf{
		PEM:      certPEM,
		Serial:   serialInt.Text(16),
		NotAfter: tmpl.NotAfter,
	}, nil
}

// SpiffeURIFromCert extracts the ct-ops SPIFFE URI from a leaf cert, returning
// the agent ID it encodes. Returns an error if the URI is missing or
// malformed.
func SpiffeURIFromCert(cert *x509.Certificate) (agentID string, err error) {
	for _, u := range cert.URIs {
		if u.Scheme != spiffeScheme || u.Host != spiffeAuthority {
			continue
		}
		// Path looks like /agent/{agentID}
		parts := splitPath(u.Path)
		if len(parts) == 2 && parts[0] == "agent" {
			return parts[1], nil
		}
	}
	return "", errors.New("no ct-ops SPIFFE URI SAN found in client cert")
}

// splitPath splits "/a/b/c/d" into ["a","b","c","d"].
func splitPath(p string) []string {
	out := []string{}
	start := 0
	for start < len(p) && p[start] == '/' {
		start++
	}
	i := start
	for j := start; j <= len(p); j++ {
		if j == len(p) || p[j] == '/' {
			if j > i {
				out = append(out, p[i:j])
			}
			i = j + 1
		}
	}
	return out
}
