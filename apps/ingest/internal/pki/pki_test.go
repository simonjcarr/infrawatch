package pki

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"testing"
	"time"
)

func newTestCA(t *testing.T) *AgentCA {
	t.Helper()
	ca, err := generateCA()
	if err != nil {
		t.Fatalf("generating CA: %v", err)
	}
	return ca
}

func buildEd25519CSR(t *testing.T) []byte {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generating ed25519 key: %v", err)
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: "ct-ops-agent"},
	}, priv)
	if err != nil {
		t.Fatalf("creating CSR: %v", err)
	}
	return der
}

func parseLeafPEM(t *testing.T, leafPEM []byte) *x509.Certificate {
	t.Helper()
	block, _ := pem.Decode(leafPEM)
	if block == nil {
		t.Fatal("no PEM block in leaf")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatalf("parsing leaf: %v", err)
	}
	return cert
}

func TestSignProducesVerifiableLeaf(t *testing.T) {
	ca := newTestCA(t)
	csrDER := buildEd25519CSR(t)

	leaf, err := ca.Sign(csrDER, "agent-123", "org-abc")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	cert := parseLeafPEM(t, leaf.PEM)

	pool := x509.NewCertPool()
	pool.AddCert(ca.Cert)
	chains, err := cert.Verify(x509.VerifyOptions{
		Roots:       pool,
		KeyUsages:   []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		CurrentTime: time.Now().Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("leaf fails chain verification: %v", err)
	}
	if len(chains) == 0 {
		t.Fatal("expected at least one verified chain")
	}

	orgID, agentID, err := SpiffeURIFromCert(cert)
	if err != nil {
		t.Fatalf("extracting SPIFFE: %v", err)
	}
	if orgID != "org-abc" || agentID != "agent-123" {
		t.Fatalf("wrong SPIFFE identity: got org=%s agent=%s", orgID, agentID)
	}

	if leaf.Serial == "" {
		t.Fatal("empty serial")
	}
	if len(fingerprint(ca.Cert)) != 64 {
		t.Fatalf("fingerprint length = %d, want 64", len(fingerprint(ca.Cert)))
	}
}

func TestSignRejectsEmptyIDs(t *testing.T) {
	ca := newTestCA(t)
	csrDER := buildEd25519CSR(t)

	if _, err := ca.Sign(csrDER, "", "org"); err == nil {
		t.Fatal("expected error with empty agentID")
	}
	if _, err := ca.Sign(csrDER, "agent", ""); err == nil {
		t.Fatal("expected error with empty orgID")
	}
}

func TestSignRejectsMalformedCSR(t *testing.T) {
	ca := newTestCA(t)
	if _, err := ca.Sign([]byte("not a csr"), "agent", "org"); err == nil {
		t.Fatal("expected error on malformed CSR")
	}
}

func TestVerifyLeafDetectsRevocation(t *testing.T) {
	ca := newTestCA(t)
	leaf, err := ca.Sign(buildEd25519CSR(t), "agent-xyz", "org-xyz")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	cert := parseLeafPEM(t, leaf.PEM)

	rev := &Revocation{set: map[string]struct{}{leaf.Serial: {}}}
	if _, _, err := VerifyLeaf([][]*x509.Certificate{{cert}}, rev); err == nil {
		t.Fatal("expected revocation rejection")
	}
}

func TestVerifyLeafWithoutRevocationPasses(t *testing.T) {
	ca := newTestCA(t)
	leaf, err := ca.Sign(buildEd25519CSR(t), "agent-ok", "org-ok")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	cert := parseLeafPEM(t, leaf.PEM)

	rev := &Revocation{set: map[string]struct{}{}}
	orgID, agentID, err := VerifyLeaf([][]*x509.Certificate{{cert}}, rev)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if orgID != "org-ok" || agentID != "agent-ok" {
		t.Fatalf("wrong identity returned: got org=%s agent=%s", orgID, agentID)
	}
}

func TestTrustPoolIncludesPreviousCAs(t *testing.T) {
	ca1 := newTestCA(t)
	ca2 := newTestCA(t)
	ca2.PreviousCerts = []*x509.Certificate{ca1.Cert}

	pool := ca2.TrustPool()
	// Sign a leaf with ca1 and verify against ca2's overlap pool.
	leaf, err := ca1.Sign(buildEd25519CSR(t), "a", "o")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	cert := parseLeafPEM(t, leaf.PEM)
	if _, err := cert.Verify(x509.VerifyOptions{
		Roots:     pool,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		t.Fatalf("previous-generation leaf failed to verify during overlap: %v", err)
	}
}
