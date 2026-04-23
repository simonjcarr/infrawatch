package pki

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"
)

// encodeECKeyOpenSSLStyle returns a PEM bundle that prepends an EC PARAMETERS
// block before EC PRIVATE KEY — the layout that `openssl ecparam -genkey -name
// prime256v1 -out key.pem` emits. Operators often BYO a key file in this
// shape, so the parser has to tolerate it.
func encodeECKeyOpenSSLStyle(t *testing.T, priv *ecdsa.PrivateKey) []byte {
	t.Helper()
	ecDER, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	paramDER, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal params: %v", err)
	}
	out := pem.EncodeToMemory(&pem.Block{Type: "EC PARAMETERS", Bytes: paramDER})
	out = append(out, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: ecDER})...)
	return out
}

func mintCA(t *testing.T, priv *ecdsa.PrivateKey) []byte {
	t.Helper()
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "test-byo-ca"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(24 * time.Hour),
		IsCA:         true,
		KeyUsage:     x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("mint ca: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func TestParseCertAndKeyAcceptsDualBlockOpenSSLKey(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa: %v", err)
	}
	certPEM := mintCA(t, priv)
	keyPEM := encodeECKeyOpenSSLStyle(t, priv)

	cert, key, err := parseCertAndKey(certPEM, keyPEM)
	if err != nil {
		t.Fatalf("parseCertAndKey: %v", err)
	}
	if cert == nil || key == nil {
		t.Fatal("expected non-nil cert and key")
	}
	if !cert.IsCA {
		t.Fatal("cert should be flagged as CA")
	}
}

func TestParseCertAndKeyRejectsKeyMismatch(t *testing.T) {
	privA, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	privB, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	certPEM := mintCA(t, privA)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY",
		Bytes: mustMarshalEC(t, privB)})
	if _, _, err := parseCertAndKey(certPEM, keyPEM); err == nil {
		t.Fatal("expected error when key does not match cert")
	}
}

func TestParseCertAndKeyRejectsNonCACert(t *testing.T) {
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	// Leaf cert (IsCA=false).
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "leaf"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		IsCA:         false,
		BasicConstraintsValid: true,
	}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: mustMarshalEC(t, priv)})

	if _, _, err := parseCertAndKey(certPEM, keyPEM); err == nil {
		t.Fatal("expected rejection of non-CA cert")
	}
}

func mustMarshalEC(t *testing.T, priv *ecdsa.PrivateKey) []byte {
	t.Helper()
	der, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return der
}
