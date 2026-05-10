package handlers

import (
	"context"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestRegistrationLimiterBlocksRepeatedSourceAndTokenAttempts(t *testing.T) {
	t.Parallel()

	limiter := NewRegistrationLimiter(RegistrationLimiterConfig{
		SourceLimit:      100,
		SourceTokenLimit: 2,
		Window:           time.Minute,
		Now:              fixedClock(time.Unix(100, 0)),
	})
	ctx := peer.NewContext(context.Background(), &peer.Peer{Addr: &net.TCPAddr{IP: net.ParseIP("203.0.113.9"), Port: 43123}})

	for range 2 {
		if err := limiter.Allow(ctx, "enrolment-token-a"); err != nil {
			t.Fatalf("Allow() unexpected error = %v", err)
		}
	}

	if err := limiter.Allow(ctx, "enrolment-token-a"); err == nil {
		t.Fatal("Allow() accepted repeated attempts for the same source/token")
	}
}

func TestRegistrationLimiterSeparatesTokenPrefixes(t *testing.T) {
	t.Parallel()

	limiter := NewRegistrationLimiter(RegistrationLimiterConfig{
		SourceLimit:      100,
		SourceTokenLimit: 1,
		Window:           time.Minute,
		Now:              fixedClock(time.Unix(100, 0)),
	})
	ctx := peer.NewContext(context.Background(), &peer.Peer{Addr: &net.TCPAddr{IP: net.ParseIP("203.0.113.9"), Port: 43123}})

	if err := limiter.Allow(ctx, "enrolment-token-a"); err != nil {
		t.Fatalf("Allow(first token) error = %v", err)
	}
	if err := limiter.Allow(ctx, "enrolment-token-b"); err != nil {
		t.Fatalf("Allow(second token) error = %v", err)
	}
}

func TestRegistrationLimiterExpiresWindow(t *testing.T) {
	t.Parallel()

	now := time.Unix(100, 0)
	limiter := NewRegistrationLimiter(RegistrationLimiterConfig{
		SourceLimit:      1,
		SourceTokenLimit: 1,
		Window:           time.Minute,
		Now: func() time.Time {
			return now
		},
	})
	ctx := peer.NewContext(context.Background(), &peer.Peer{Addr: &net.TCPAddr{IP: net.ParseIP("203.0.113.9"), Port: 43123}})

	if err := limiter.Allow(ctx, "enrolment-token-a"); err != nil {
		t.Fatalf("Allow(first window) error = %v", err)
	}
	if err := limiter.Allow(ctx, "enrolment-token-a"); err == nil {
		t.Fatal("Allow() accepted repeated attempt inside the same window")
	}

	now = now.Add(time.Minute + time.Second)
	if err := limiter.Allow(ctx, "enrolment-token-a"); err != nil {
		t.Fatalf("Allow(next window) error = %v", err)
	}
}

func TestRegisterThrottlesBeforeTokenLookup(t *testing.T) {
	t.Parallel()

	limiter := NewRegistrationLimiter(RegistrationLimiterConfig{
		SourceLimit:      1,
		SourceTokenLimit: 1,
		Window:           time.Minute,
		Now:              fixedClock(time.Unix(100, 0)),
	})
	ctx := peer.NewContext(context.Background(), &peer.Peer{Addr: &net.TCPAddr{IP: net.ParseIP("203.0.113.9"), Port: 43123}})
	if err := limiter.Allow(ctx, "enrolment-token-a"); err != nil {
		t.Fatalf("preconsuming limiter allowance: %v", err)
	}

	handler := &RegisterHandler{registrationLimiter: limiter}
	_, err := handler.Register(ctx, &agentv1.RegisterRequest{
		EnrolmentToken: "enrolment-token-a",
		PublicKey:      "agent-public-key",
	})
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("Register() error code = %v, want %v (err=%v)", status.Code(err), codes.ResourceExhausted, err)
	}
}

func fixedClock(now time.Time) func() time.Time {
	return func() time.Time {
		return now
	}
}
