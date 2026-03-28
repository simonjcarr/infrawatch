package agentgrpc

import (
	"fmt"

	"google.golang.org/grpc"
)

// Connect establishes a gRPC connection to the ingest service.
func Connect(address, caCertFile string) (*grpc.ClientConn, error) {
	creds, err := BuildTLSCredentials(caCertFile)
	if err != nil {
		return nil, fmt.Errorf("building TLS credentials: %w", err)
	}

	conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, fmt.Errorf("connecting to %s: %w", address, err)
	}
	return conn, nil
}
