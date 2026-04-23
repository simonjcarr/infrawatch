package agentgrpc

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"google.golang.org/grpc/credentials"
)

// BuildTLSCredentials builds gRPC transport credentials for the agent.
//
// caCertFile:    path to the server's CA cert PEM; empty = system roots.
// skipVerify:    if true, disable TLS verification (insecure — dev only).
// clientCert:    if non-nil, presented during the TLS handshake for mTLS.
//
// Prior to the mTLS rollout clientCert would typically be nil on the very
// first connection (the agent hasn't been issued a cert yet) and populated
// once the server has signed one. The caller is responsible for loading the
// cert from disk via identity.TLSCertificate and redialling when a new cert
// arrives via HeartbeatResponse.pending_client_cert_pem.
func BuildTLSCredentials(caCertFile string, skipVerify bool, clientCert *tls.Certificate) (credentials.TransportCredentials, error) {
	tlsCfg := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: skipVerify, //nolint:gosec // controlled by explicit user config
	}

	if !skipVerify && caCertFile != "" {
		caBytes, err := os.ReadFile(caCertFile)
		if err != nil {
			return nil, fmt.Errorf("reading CA cert %s: %w", caCertFile, err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caBytes) {
			return nil, fmt.Errorf("parsing CA cert %s", caCertFile)
		}
		tlsCfg.RootCAs = pool
	}

	if clientCert != nil {
		tlsCfg.Certificates = []tls.Certificate{*clientCert}
	}

	return credentials.NewTLS(tlsCfg), nil
}
