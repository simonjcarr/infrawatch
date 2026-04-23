package ingesttls

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"

	"google.golang.org/grpc/credentials"
)

// BuildServerCredentials builds gRPC server TLS credentials with mTLS.
//
// ClientAuth is VerifyClientCertIfGiven — a brand-new agent cannot present a
// client cert on its very first Register call, so the handshake must accept
// cert-less connections. Authorisation is still enforced: a server-side gRPC
// interceptor (authInterceptor in apps/ingest/internal/grpc) rejects every
// RPC other than Register unless a verified client cert is present and its
// SPIFFE URI matches the JWT subject.
//
// clientCAPool is the set of CAs that signed valid agent client certs — it
// must include previous-generation CAs during a rotation overlap window.
// verifyLeaf is called after standard chain verification passes; it may
// return an error to reject. verifyLeaf is not called for cert-less handshakes.
func BuildServerCredentials(
	certFile, keyFile string,
	clientCAPool *x509.CertPool,
	verifyLeaf func(verifiedChains [][]*x509.Certificate) error,
) (credentials.TransportCredentials, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("loading TLS key pair (%s, %s): %w", certFile, keyFile, err)
	}
	if clientCAPool == nil {
		return nil, errors.New("mTLS enabled: clientCAPool is required")
	}
	cfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
		ClientAuth:   tls.VerifyClientCertIfGiven,
		ClientCAs:    clientCAPool,
		VerifyPeerCertificate: func(_ [][]byte, verifiedChains [][]*x509.Certificate) error {
			if len(verifiedChains) == 0 {
				return nil // cert-less (Register-only) handshake
			}
			if verifyLeaf == nil {
				return nil
			}
			return verifyLeaf(verifiedChains)
		},
	}
	return credentials.NewTLS(cfg), nil
}
