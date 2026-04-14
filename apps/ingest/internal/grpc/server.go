package ingestgrpc

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/keepalive"

	"github.com/infrawatch/ingest/internal/handlers"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// ingestService implements agentv1.IngestServiceServer.
type ingestService struct {
	agentv1.UnimplementedIngestServiceServer
	reg      *handlers.RegisterHandler
	hb       *handlers.HeartbeatHandler
	terminal *handlers.TerminalHandler
	inv      *handlers.InventoryHandler
}

func (s *ingestService) Register(ctx context.Context, req *agentv1.RegisterRequest) (*agentv1.RegisterResponse, error) {
	return s.reg.Register(ctx, req)
}

func (s *ingestService) Heartbeat(stream agentv1.IngestService_HeartbeatServer) error {
	return s.hb.Heartbeat(stream)
}

func (s *ingestService) Terminal(stream agentv1.IngestService_TerminalServer) error {
	return s.terminal.Terminal(stream)
}

func (s *ingestService) SubmitSoftwareInventory(stream agentv1.IngestService_SubmitSoftwareInventoryServer) error {
	return s.inv.SubmitSoftwareInventory(stream)
}

// Serve starts the gRPC server on the given port with TLS credentials.
// Blocks until the server stops. When ctx is cancelled (e.g. SIGTERM), Serve
// sends a gRPC GOAWAY to all connected agents so they reconnect immediately
// rather than hitting exponential backoff. If streams don't drain within 30s,
// the server is force-stopped — this covers the case where a container is
// killed before context cancellation can propagate.
func Serve(ctx context.Context, port int, creds credentials.TransportCredentials, reg *handlers.RegisterHandler, hb *handlers.HeartbeatHandler, terminal *handlers.TerminalHandler, inv *handlers.InventoryHandler) error {
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("listening on :%d: %w", port, err)
	}

	// Permit the agent's 30s client pings (with safety margin) and proactively
	// ping idle agents from the server side too, so a dead peer is detected
	// within ~80s instead of waiting for the OS TCP timeout.
	enforcement := keepalive.EnforcementPolicy{
		MinTime:             10 * time.Second,
		PermitWithoutStream: true,
	}
	serverKp := keepalive.ServerParameters{
		Time:    60 * time.Second,
		Timeout: 20 * time.Second,
	}

	opts := []grpc.ServerOption{
		grpc.Creds(creds),
		grpc.KeepaliveEnforcementPolicy(enforcement),
		grpc.KeepaliveParams(serverKp),
		grpc.ChainUnaryInterceptor(RecoveryUnaryInterceptor, LoggingUnaryInterceptor),
		grpc.ChainStreamInterceptor(RecoveryStreamInterceptor, LoggingStreamInterceptor),
	}
	grpcServer := grpc.NewServer(opts...)

	svc := &ingestService{reg: reg, hb: hb, terminal: terminal, inv: inv}
	agentv1.RegisterIngestServiceServer(grpcServer, svc)

	// Graceful shutdown on context cancellation. GracefulStop sends GOAWAY
	// so agents reconnect immediately; Stop is the hard fallback if streams
	// don't drain within 30s (e.g. a long-running check is in flight).
	go func() {
		<-ctx.Done()
		slog.Info("gRPC server shutting down gracefully")
		stopped := make(chan struct{})
		go func() {
			grpcServer.GracefulStop()
			close(stopped)
		}()
		select {
		case <-stopped:
			slog.Info("gRPC server stopped gracefully")
		case <-time.After(30 * time.Second):
			slog.Warn("graceful stop timed out, forcing shutdown")
			grpcServer.Stop()
		}
	}()

	return grpcServer.Serve(lis)
}
