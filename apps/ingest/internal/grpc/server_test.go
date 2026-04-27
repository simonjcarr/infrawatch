package ingestgrpc

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const testRegisterMethod = "/agent.v1.IngestService/Register"

type registerService interface {
	Register(context.Context, *agentv1.RegisterRequest) (*agentv1.RegisterResponse, error)
}

type blockingRegisterService struct {
	started      chan struct{}
	release      <-chan struct{}
	responseSize int
}

func (s *blockingRegisterService) Register(ctx context.Context, req *agentv1.RegisterRequest) (*agentv1.RegisterResponse, error) {
	if s.started != nil {
		s.started <- struct{}{}
	}
	if s.release != nil {
		select {
		case <-s.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	resp := &agentv1.RegisterResponse{Status: "ok"}
	if s.responseSize > 0 {
		resp.Message = strings.Repeat("x", s.responseSize)
	}
	return resp, nil
}

var registerServiceDesc = grpc.ServiceDesc{
	ServiceName: "agent.v1.IngestService",
	HandlerType: (*registerService)(nil),
	Methods: []grpc.MethodDesc{{
		MethodName: "Register",
		Handler: func(srv interface{}, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
			in := new(agentv1.RegisterRequest)
			if err := dec(in); err != nil {
				return nil, err
			}
			if interceptor == nil {
				return srv.(registerService).Register(ctx, in)
			}
			info := &grpc.UnaryServerInfo{Server: srv, FullMethod: testRegisterMethod}
			handler := func(ctx context.Context, req any) (any, error) {
				return srv.(registerService).Register(ctx, req.(*agentv1.RegisterRequest))
			}
			return interceptor(ctx, in, info, handler)
		},
	}},
}

func newBufconnClient(t *testing.T, svc registerService) (*grpc.ClientConn, func()) {
	t.Helper()

	listener := bufconn.Listen(128 * 1024 * 1024)
	server := grpc.NewServer(serverOptions(nil)...)
	server.RegisterService(&registerServiceDesc, svc)

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.Serve(listener)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	conn, err := grpc.DialContext(
		ctx,
		"bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return listener.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallSendMsgSize(maxMessageSizeBytes+1024),
			grpc.MaxCallRecvMsgSize(maxMessageSizeBytes+1024),
		),
	)
	cancel()
	if err != nil {
		server.Stop()
		t.Fatalf("dial bufconn: %v", err)
	}

	cleanup := func() {
		_ = conn.Close()
		server.Stop()
		_ = listener.Close()
		select {
		case err := <-serveErr:
			if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
				t.Fatalf("serve bufconn: %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out stopping bufconn server")
		}
	}

	return conn, cleanup
}

func TestServerRejectsOversizedRegisterRequest(t *testing.T) {
	conn, cleanup := newBufconnClient(t, &blockingRegisterService{})
	defer cleanup()

	req := &agentv1.RegisterRequest{PublicKey: strings.Repeat("a", maxMessageSizeBytes+1)}
	var resp agentv1.RegisterResponse
	err := conn.Invoke(context.Background(), testRegisterMethod, req, &resp)
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", err)
	}
	if !strings.Contains(err.Error(), "received message larger than max") {
		t.Fatalf("expected oversized receive error, got %v", err)
	}
}

func TestServerRejectsOversizedRegisterResponse(t *testing.T) {
	conn, cleanup := newBufconnClient(t, &blockingRegisterService{responseSize: maxMessageSizeBytes + 1})
	defer cleanup()

	req := &agentv1.RegisterRequest{PublicKey: "small"}
	var resp agentv1.RegisterResponse
	err := conn.Invoke(context.Background(), testRegisterMethod, req, &resp)
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", err)
	}
	if !strings.Contains(err.Error(), "trying to send message larger than max") {
		t.Fatalf("expected oversized send error, got %v", err)
	}
}

func TestServerCapsConcurrentRegisterStreamsPerConnection(t *testing.T) {
	started := make(chan struct{}, maxConcurrentStreams+1)
	release := make(chan struct{})
	conn, cleanup := newBufconnClient(t, &blockingRegisterService{
		started: started,
		release: release,
	})
	defer cleanup()

	var wg sync.WaitGroup
	errs := make(chan error, maxConcurrentStreams+1)

	for i := 0; i < maxConcurrentStreams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var resp agentv1.RegisterResponse
			errs <- conn.Invoke(context.Background(), testRegisterMethod, &agentv1.RegisterRequest{PublicKey: "small"}, &resp)
		}()
	}

	for i := 0; i < maxConcurrentStreams; i++ {
		select {
		case <-started:
		case <-time.After(10 * time.Second):
			t.Fatalf("timed out waiting for request %d to start", i+1)
		}
	}

	extraCtx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	wg.Add(1)
	go func() {
		defer wg.Done()
		var resp agentv1.RegisterResponse
		errs <- conn.Invoke(extraCtx, testRegisterMethod, &agentv1.RegisterRequest{PublicKey: "small"}, &resp)
	}()

	select {
	case <-started:
		t.Fatal("extra request started despite MaxConcurrentStreams cap")
	case <-time.After(300 * time.Millisecond):
	}

	close(release)
	wg.Wait()
	close(errs)

	var deadlineCount int
	for err := range errs {
		if err == nil {
			continue
		}
		if status.Code(err) != codes.DeadlineExceeded {
			t.Fatalf("unexpected error after releasing requests: %v", err)
		}
		deadlineCount++
	}
	if deadlineCount != 1 {
		t.Fatalf("expected one timed-out extra request, got %d", deadlineCount)
	}
}
