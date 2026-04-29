package vuln

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

type matchRequest struct {
	hostID string
	all    bool
}

// MatchScheduler bounds asynchronous vulnerability matching work triggered by
// inventory scans and feed syncs.
type MatchScheduler struct {
	pool  *pgxpool.Pool
	queue chan matchRequest
}

func StartMatchScheduler(ctx context.Context, pool *pgxpool.Pool, workers, queueSize int) *MatchScheduler {
	if workers <= 0 {
		workers = 1
	}
	if queueSize <= 0 {
		queueSize = 100
	}
	s := &MatchScheduler{
		pool:  pool,
		queue: make(chan matchRequest, queueSize),
	}
	for i := 0; i < workers; i++ {
		go s.runWorker(ctx)
	}
	return s
}

func (s *MatchScheduler) EnqueueHost(hostID string) bool {
	if s == nil || hostID == "" {
		return false
	}
	return s.enqueue(matchRequest{hostID: hostID})
}

func (s *MatchScheduler) EnqueueAllHosts() bool {
	if s == nil {
		return false
	}
	return s.enqueue(matchRequest{all: true})
}

func (s *MatchScheduler) enqueue(req matchRequest) bool {
	select {
	case s.queue <- req:
		return true
	default:
		return false
	}
}

func (s *MatchScheduler) runWorker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case req := <-s.queue:
			if req.all {
				if err := MatchAllHosts(ctx, s.pool); err != nil {
					slog.Warn("vulnerability matcher: all-host match failed", "err", err)
				}
				continue
			}
			if err := MatchHost(ctx, s.pool, req.hostID); err != nil {
				slog.Warn("vulnerability matcher: host match failed", "host_id", req.hostID, "err", err)
			}
		}
	}
}
