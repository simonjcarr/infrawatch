package ingesttls

import (
	"crypto/tls"
	"fmt"

	"google.golang.org/grpc/credentials"
)

// BuildServerCredentials builds gRPC server TLS credentials from cert and key files.
// Structured to extend with mTLS client CA verification in a future session.
func BuildServerCredentials(certFile, keyFile string) (credentials.TransportCredentials, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("loading TLS key pair (%s, %s): %w", certFile, keyFile, err)
	}
	cfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
	return credentials.NewTLS(cfg), nil
}
