package checks

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadCertRejectsSymlinkedFiles(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	certPath := filepath.Join(dir, "cert.pem")
	linkPath := filepath.Join(dir, "cert-link.pem")

	writeTestPEMCert(t, certPath)
	if err := os.Symlink(certPath, linkPath); err != nil {
		t.Fatalf("symlink cert file: %v", err)
	}

	_, err := loadCert(CertFileConfig{
		FilePath: linkPath,
		Format:   "pem",
	})
	if err == nil {
		t.Fatal("expected symlinked cert file to be rejected")
	}
	if !strings.Contains(err.Error(), "symlinked certificate files are not allowed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadCertReadsRegularFiles(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	certPath := filepath.Join(dir, "cert.pem")
	writeTestPEMCert(t, certPath)

	cert, err := loadCert(CertFileConfig{
		FilePath: certPath,
		Format:   "pem",
	})
	if err != nil {
		t.Fatalf("load regular cert file: %v", err)
	}
	if got := cert.Subject.CommonName; got != "example.test" {
		t.Fatalf("unexpected common name: %q", got)
	}
}

func writeTestPEMCert(t *testing.T, path string) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "example.test",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"example.test"},
	}

	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}

	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create cert file: %v", err)
	}
	defer file.Close()

	if err := pem.Encode(file, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		t.Fatalf("encode cert pem: %v", err)
	}
}
