//go:build !windows

package main

import "context"

// runService on non-Windows is a passthrough — no service manager integration needed.
func runService(ctx context.Context, _ context.CancelFunc, runFn func(context.Context) error) error {
	return runFn(ctx)
}
