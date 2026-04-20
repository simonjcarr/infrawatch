//go:build windows

package main

import (
	"context"
	"log/slog"

	"golang.org/x/sys/windows/svc"
)

type windowsService struct {
	cancel context.CancelFunc
}

// Execute implements svc.Handler. It signals Running to the SCM and waits
// for a Stop or Shutdown request, at which point it cancels the agent context.
func (ws *windowsService) Execute(
	_ []string,
	r <-chan svc.ChangeRequest,
	status chan<- svc.Status,
) (bool, uint32) {
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for c := range r {
		switch c.Cmd {
		case svc.Stop, svc.Shutdown:
			slog.Info("service stop requested")
			ws.cancel()
			status <- svc.Status{State: svc.StopPending}
			return false, 0
		}
	}
	return false, 0
}

// runService detects whether the process was started by the Windows SCM.
// If so, it runs via svc.Run() so the SCM receives proper start/stop signals.
// If not (interactive/foreground), runFn is called directly.
func runService(ctx context.Context, cancel context.CancelFunc, runFn func(context.Context) error) error {
	isSvc, err := svc.IsWindowsService()
	if err != nil || !isSvc {
		return runFn(ctx)
	}

	// Under the SCM there is no attached console, so the default stdout
	// handler discards everything. Swap the default slog handler to one that
	// writes to the Windows Event Log so operators can actually see agent
	// output. Fall through to stdout if the source isn't registered.
	if h := openEventLogHandler(slog.LevelInfo); h != nil {
		slog.SetDefault(slog.New(h))
	}

	ws := &windowsService{cancel: cancel}
	// Run the agent loop in a goroutine — svc.Run blocks until the service stops.
	go func() {
		if err := runFn(ctx); err != nil && err != context.Canceled {
			slog.Error("agent loop error", "err", err)
			cancel()
		}
	}()
	return svc.Run("InfrawatchAgent", ws)
}
