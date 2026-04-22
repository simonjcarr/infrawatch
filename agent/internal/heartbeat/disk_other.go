//go:build !linux

package heartbeat

import agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"

// readAllDisks returns an empty slice on non-Linux platforms.
func readAllDisks() []*agentv1.DiskInfo {
	return nil
}
