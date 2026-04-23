package pki

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Revocation is an in-memory set of revoked cert serials, refreshed from the
// revoked_certificates table. Handshake verification checks this set.
type Revocation struct {
	mu     sync.RWMutex
	set    map[string]struct{}
	pool   *pgxpool.Pool
	reload chan struct{}
}

// NewRevocation builds a Revocation set and performs the initial bulk load.
func NewRevocation(ctx context.Context, pool *pgxpool.Pool) (*Revocation, error) {
	r := &Revocation{
		pool:   pool,
		set:    map[string]struct{}{},
		reload: make(chan struct{}, 1),
	}
	if err := r.load(ctx); err != nil {
		return nil, err
	}
	return r, nil
}

// Has returns true if the given serial is revoked.
func (r *Revocation) Has(serial string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.set[serial]
	return ok
}

// Reload schedules a non-blocking reload of the revocation set.
func (r *Revocation) Reload() {
	select {
	case r.reload <- struct{}{}:
	default:
	}
}

// Run drives periodic reloads plus on-demand reloads via Reload(). Call as
// a goroutine; returns when ctx is cancelled.
func (r *Revocation) Run(ctx context.Context, interval time.Duration) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := r.load(ctx); err != nil {
				slog.Warn("revocation reload", "err", err)
			}
		case <-r.reload:
			if err := r.load(ctx); err != nil {
				slog.Warn("revocation reload", "err", err)
			}
		}
	}
}

func (r *Revocation) load(ctx context.Context) error {
	rows, err := r.pool.Query(ctx, `SELECT serial FROM revoked_certificates`)
	if err != nil {
		return err
	}
	defer rows.Close()
	next := map[string]struct{}{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return err
		}
		next[s] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	r.set = next
	r.mu.Unlock()
	return nil
}
