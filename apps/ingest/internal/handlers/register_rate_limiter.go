package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

const (
	defaultRegistrationSourceLimit      = 120
	defaultRegistrationSourceTokenLimit = 30
	defaultRegistrationWindow           = time.Minute
)

type RegistrationLimiterConfig struct {
	SourceLimit      int
	SourceTokenLimit int
	Window           time.Duration
	Now              func() time.Time
}

type RegistrationLimiter struct {
	mu      sync.Mutex
	config  RegistrationLimiterConfig
	buckets map[string]registrationAttemptBucket
}

type registrationAttemptBucket struct {
	count   int
	resetAt time.Time
}

func NewRegistrationLimiter(config RegistrationLimiterConfig) *RegistrationLimiter {
	if config.SourceLimit <= 0 {
		config.SourceLimit = defaultRegistrationSourceLimit
	}
	if config.SourceTokenLimit <= 0 {
		config.SourceTokenLimit = defaultRegistrationSourceTokenLimit
	}
	if config.Window <= 0 {
		config.Window = defaultRegistrationWindow
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &RegistrationLimiter{
		config:  config,
		buckets: make(map[string]registrationAttemptBucket),
	}
}

func NewDefaultRegistrationLimiter() *RegistrationLimiter {
	return NewRegistrationLimiter(RegistrationLimiterConfig{})
}

func (l *RegistrationLimiter) Allow(ctx context.Context, orgToken string) error {
	if l == nil {
		return nil
	}

	now := l.config.Now()
	sourceKey := "source:" + registrationSource(ctx)
	sourceTokenKey := sourceKey + ":token:" + tokenHashPrefix(orgToken)

	l.mu.Lock()
	defer l.mu.Unlock()

	if !l.allowBucket(sourceKey, now, l.config.SourceLimit) || !l.allowBucket(sourceTokenKey, now, l.config.SourceTokenLimit) {
		return status.Error(codes.ResourceExhausted, "too many registration attempts; retry later")
	}
	return nil
}

func (l *RegistrationLimiter) allowBucket(key string, now time.Time, limit int) bool {
	bucket := l.buckets[key]
	if bucket.resetAt.IsZero() || !now.Before(bucket.resetAt) {
		bucket = registrationAttemptBucket{resetAt: now.Add(l.config.Window)}
	}
	if bucket.count >= limit {
		l.buckets[key] = bucket
		return false
	}
	bucket.count++
	l.buckets[key] = bucket
	return true
}

func registrationSource(ctx context.Context) string {
	p, ok := peer.FromContext(ctx)
	if !ok || p == nil || p.Addr == nil {
		return "unknown"
	}
	if tcp, ok := p.Addr.(*net.TCPAddr); ok {
		return tcp.IP.String()
	}
	host, _, err := net.SplitHostPort(p.Addr.String())
	if err == nil && host != "" {
		return host
	}
	return p.Addr.String()
}

func tokenHashPrefix(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])[:16]
}
