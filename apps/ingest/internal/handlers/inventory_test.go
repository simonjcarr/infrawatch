package handlers

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/ingest/internal/auth"
	"github.com/carrtech-dev/ct-ops/ingest/internal/pki"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

type inventoryAuthTestStream struct {
	ctx context.Context
}

func (s *inventoryAuthTestStream) SetHeader(metadata.MD) error {
	return nil
}

func (s *inventoryAuthTestStream) SendHeader(metadata.MD) error {
	return nil
}

func (s *inventoryAuthTestStream) SetTrailer(metadata.MD) {}

func (s *inventoryAuthTestStream) Context() context.Context {
	return s.ctx
}

func (s *inventoryAuthTestStream) SendAndClose(*agentv1.SoftwareInventoryAck) error {
	return nil
}

func (s *inventoryAuthTestStream) SendMsg(any) error {
	return nil
}

func (s *inventoryAuthTestStream) RecvMsg(any) error {
	return nil
}

func (s *inventoryAuthTestStream) Recv() (*agentv1.SoftwareInventoryChunk, error) {
	return nil, context.Canceled
}

func TestValidateInventoryChunkAllowsConfiguredLimit(t *testing.T) {
	chunk := &agentv1.SoftwareInventoryChunk{
		ChunkIndex: 7,
		Packages:   make([]*agentv1.SoftwarePackage, maxInventoryPackagesPerChunk),
	}

	if err := validateInventoryChunk(chunk); err != nil {
		t.Fatalf("validateInventoryChunk() unexpected error: %v", err)
	}
}

func TestValidateInventoryChunkRejectsOversizedChunk(t *testing.T) {
	chunk := &agentv1.SoftwareInventoryChunk{
		ChunkIndex: 8,
		Packages:   make([]*agentv1.SoftwarePackage, maxInventoryPackagesPerChunk+1),
	}

	err := validateInventoryChunk(chunk)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code(err) = %v, want %v (err=%v)", status.Code(err), codes.InvalidArgument, err)
	}
	if !strings.Contains(err.Error(), "exceeds maximum") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestInventoryAuthenticateStreamRejectsExpiredJWT(t *testing.T) {
	t.Parallel()

	issuer, err := auth.NewJWTIssuer(nil, filepath.Join(t.TempDir(), "jwt.pem"), "test-issuer", -time.Minute)
	if err != nil {
		t.Fatalf("NewJWTIssuer: %v", err)
	}

	token, err := issuer.IssueAgentToken("agent-123", "org-123")
	if err != nil {
		t.Fatalf("IssueAgentToken: %v", err)
	}

	stream := &inventoryAuthTestStream{
		ctx: pki.WithIdentity(metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", "Bearer "+token)), &pki.Identity{
			OrgID:   "org-123",
			AgentID: "agent-123",
		}),
	}

	_, err = NewInventoryHandler(nil, issuer).authenticateStream(stream)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("authenticateStream() code = %v, want %v (err=%v)", status.Code(err), codes.Unauthenticated, err)
	}
}

func TestInventoryAuthenticateStreamRejectsMTLSJWTMismatch(t *testing.T) {
	t.Parallel()

	issuer, err := auth.NewJWTIssuer(nil, filepath.Join(t.TempDir(), "jwt.pem"), "test-issuer", time.Hour)
	if err != nil {
		t.Fatalf("NewJWTIssuer: %v", err)
	}

	token, err := issuer.IssueAgentToken("agent-123", "org-123")
	if err != nil {
		t.Fatalf("IssueAgentToken: %v", err)
	}

	stream := &inventoryAuthTestStream{
		ctx: pki.WithIdentity(metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", "Bearer "+token)), &pki.Identity{
			OrgID:   "org-123",
			AgentID: "agent-999",
		}),
	}

	_, err = NewInventoryHandler(nil, issuer).authenticateStream(stream)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("authenticateStream() code = %v, want %v (err=%v)", status.Code(err), codes.Unauthenticated, err)
	}
}

func TestInventoryAuthenticateStreamAcceptsMatchingMTLSIdentity(t *testing.T) {
	t.Parallel()

	issuer, err := auth.NewJWTIssuer(nil, filepath.Join(t.TempDir(), "jwt.pem"), "test-issuer", time.Hour)
	if err != nil {
		t.Fatalf("NewJWTIssuer: %v", err)
	}

	token, err := issuer.IssueAgentToken("agent-123", "org-123")
	if err != nil {
		t.Fatalf("IssueAgentToken: %v", err)
	}

	stream := &inventoryAuthTestStream{
		ctx: pki.WithIdentity(metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", "Bearer "+token)), &pki.Identity{
			OrgID:   "org-123",
			AgentID: "agent-123",
		}),
	}

	agentID, err := NewInventoryHandler(nil, issuer).authenticateStream(stream)
	if err != nil {
		t.Fatalf("authenticateStream() unexpected error: %v", err)
	}
	if agentID != "agent-123" {
		t.Fatalf("authenticateStream() agentID = %q, want %q", agentID, "agent-123")
	}
}
