package handlers

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/ingest/internal/auth"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

type heartbeatTestStream struct {
	ctx      context.Context
	requests []*agentv1.HeartbeatRequest
}

func (s *heartbeatTestStream) SetHeader(metadata.MD) error {
	return nil
}

func (s *heartbeatTestStream) SendHeader(metadata.MD) error {
	return nil
}

func (s *heartbeatTestStream) SetTrailer(metadata.MD) {}

func (s *heartbeatTestStream) Context() context.Context {
	return s.ctx
}

func (s *heartbeatTestStream) Send(*agentv1.HeartbeatResponse) error {
	return nil
}

func (s *heartbeatTestStream) SendMsg(any) error {
	return nil
}

func (s *heartbeatTestStream) RecvMsg(any) error {
	return nil
}

func (s *heartbeatTestStream) Recv() (*agentv1.HeartbeatRequest, error) {
	if len(s.requests) == 0 {
		return nil, context.Canceled
	}
	req := s.requests[0]
	s.requests = s.requests[1:]
	return req, nil
}

func TestHeartbeatRejectsInvalidFirstMessageJWT(t *testing.T) {
	t.Parallel()

	issuer, err := auth.NewJWTIssuer(nil, filepath.Join(t.TempDir(), "jwt.pem"), "test-issuer", time.Hour)
	if err != nil {
		t.Fatalf("NewJWTIssuer: %v", err)
	}

	handler := NewHeartbeatHandler(nil, issuer, nil, nil, "", nil, nil)
	stream := &heartbeatTestStream{
		ctx: context.Background(),
		requests: []*agentv1.HeartbeatRequest{
			{AgentId: "agent-123"},
		},
	}

	err = handler.Heartbeat(stream)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("Heartbeat() code = %v, want %v (err=%v)", status.Code(err), codes.Unauthenticated, err)
	}
}
