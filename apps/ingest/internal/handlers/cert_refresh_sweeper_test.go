package handlers

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/url"
	"testing"
	"time"
)

func TestFetchLeafAndChainVerifiesTrustedRootsByDefault(t *testing.T) {
	t.Parallel()

	rootPEM, serverCert, closeServer := startTestTLSServer(t)
	defer closeServer()

	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(rootPEM) {
		t.Fatal("AppendCertsFromPEM() = false")
	}

	leaf, chain, err := fetchLeafAndChainWithOptions(context.Background(), serverCert.url, fetchLeafAndChainOptions{
		rootCAs: roots,
	})
	if err != nil {
		t.Fatalf("fetchLeafAndChainWithOptions() error = %v", err)
	}
	if leaf.Subject.CommonName != "localhost" {
		t.Fatalf("leaf.Subject.CommonName = %q, want localhost", leaf.Subject.CommonName)
	}
	if len(chain) != 0 {
		t.Fatalf("len(chain) = %d, want 0", len(chain))
	}
}

func TestFetchLeafAndChainRejectsUntrustedRootsUnlessOptedOut(t *testing.T) {
	t.Parallel()

	_, serverCert, closeServer := startTestTLSServer(t)
	defer closeServer()

	if _, _, err := fetchLeafAndChainWithOptions(context.Background(), serverCert.url, fetchLeafAndChainOptions{}); err == nil {
		t.Fatal("expected untrusted certificate to fail verification")
	}

	if _, _, err := fetchLeafAndChainWithOptions(context.Background(), serverCert.url, fetchLeafAndChainOptions{
		skipVerify: true,
	}); err != nil {
		t.Fatalf("fetchLeafAndChainWithOptions(skipVerify=true) error = %v", err)
	}
}

type testTLSServer struct {
	url string
}

func startTestTLSServer(t *testing.T) ([]byte, testTLSServer, func()) {
	t.Helper()

	rootKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey(root) error = %v", err)
	}
	rootTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "ct-ops test root",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("x509.CreateCertificate(root) error = %v", err)
	}
	rootPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER})
	rootCert, err := x509.ParseCertificate(rootDER)
	if err != nil {
		t.Fatalf("x509.ParseCertificate(root) error = %v", err)
	}

	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey(leaf) error = %v", err)
	}
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject: pkix.Name{
			CommonName: "localhost",
		},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		IsCA:         false,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, rootCert, &leafKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("x509.CreateCertificate(leaf) error = %v", err)
	}

	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})
	leafKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(leafKey)})
	tlsCert, err := tls.X509KeyPair(leafPEM, leafKeyPEM)
	if err != nil {
		t.Fatalf("tls.X509KeyPair() error = %v", err)
	}

	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{tlsCert},
	})
	if err != nil {
		t.Fatalf("tls.Listen() error = %v", err)
	}

	done := make(chan struct{})
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-done:
					return
				default:
					return
				}
			}
			go func(conn net.Conn) {
				defer conn.Close()
				_ = conn.(*tls.Conn).Handshake()
				<-done
			}(conn)
		}
	}()

	addr := ln.Addr().String()
	serverURL := &url.URL{Scheme: "https", Host: addr}

	return rootPEM, testTLSServer{url: serverURL.String()}, func() {
		close(done)
		_ = ln.Close()
	}
}
