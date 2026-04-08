package config

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"
)

// VersionPoller holds the current latest agent version and refreshes it from
// the release-please manifest on a fixed interval. This allows the ingest
// service to pick up new agent releases without restarting.
type VersionPoller struct {
	current  atomic.Value // stores string
	interval time.Duration
}

// NewVersionPoller returns a poller seeded with initialVersion and configured
// to refresh every interval.
func NewVersionPoller(initialVersion string, interval time.Duration) *VersionPoller {
	p := &VersionPoller{interval: interval}
	p.current.Store(initialVersion)
	return p
}

// Get returns the current latest agent version string.
func (p *VersionPoller) Get() string {
	v, _ := p.current.Load().(string)
	return v
}

// Start runs a background goroutine that refreshes the version from the
// manifest on the configured interval. It exits when ctx is cancelled.
func (p *VersionPoller) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(p.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if v := loadAgentVersionFromManifest(); v != "" {
					prev := p.Get()
					if v != prev {
						p.current.Store(v)
						slog.Info("agent latest version updated", "previous", prev, "current", v)
					}
				}
			}
		}
	}()
}
