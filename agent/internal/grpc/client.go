package agentgrpc

import (
	"context"
	"fmt"
	"net"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
)

// Connect establishes a gRPC connection to the ingest service.
func Connect(address, caCertFile string, skipVerify bool) (*grpc.ClientConn, error) {
	creds, err := BuildTLSCredentials(caCertFile, skipVerify)
	if err != nil {
		return nil, fmt.Errorf("building TLS credentials: %w", err)
	}

	// HTTP/2-level keepalive: sends PING frames every 30s so gRPC detects a
	// dead connection within 40s (30s interval + 10s timeout). This catches
	// cases where the server closes the stream cleanly (GOAWAY) or drops it.
	kp := keepalive.ClientParameters{
		Time:                30 * time.Second,
		Timeout:             10 * time.Second,
		PermitWithoutStream: true,
	}

	conn, err := grpc.NewClient(address,
		grpc.WithTransportCredentials(creds),
		grpc.WithKeepaliveParams(kp),
		// TCP-level keepalive: the OS probes the peer every 15s. This catches
		// half-open connections (e.g. NAT state expired, Docker network
		// restarted) where no RST is sent — the Linux default without this is
		// ~2 hours, causing the agent to appear stuck until manually restarted.
		grpc.WithContextDialer(func(ctx context.Context, addr string) (net.Conn, error) {
			d := &net.Dialer{KeepAlive: 15 * time.Second}
			return d.DialContext(ctx, "tcp", addr)
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("connecting to %s: %w", address, err)
	}
	return conn, nil
}
