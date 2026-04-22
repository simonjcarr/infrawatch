//go:build windows

package terminal

import (
	"fmt"

	"google.golang.org/grpc"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

// OpenSession is not supported on Windows — PTY requires a Unix-like OS.
func OpenSession(_ func() (*grpc.ClientConn, error), _ string, req *agentv1.TerminalSessionRequest) error {
	return fmt.Errorf("terminal sessions are not supported on Windows")
}
