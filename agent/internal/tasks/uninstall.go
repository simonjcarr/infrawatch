package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

func init() {
	Register("agent_uninstall", RunUninstall)
}

// uninstallResult is the JSON structure stored in task_run_hosts.result.
type uninstallResult struct {
	Status string `json:"status"`         // always "scheduled"
	Note   string `json:"note,omitempty"` // optional context for the UI
}

// RunUninstall schedules the agent to uninstall itself from the host.
//
// Uninstall is performed by a detached child process that re-executes the
// current agent binary with the existing -uninstall flag. The child survives
// after the service manager terminates this process, so the full uninstall
// sequence (service stop, file removal, daemon reload) always completes.
//
// A short delay is inserted between the handler returning and the child
// launching so that the "scheduled" result is shipped back to the server on
// the next heartbeat before we are killed. Output is captured to
// /tmp/infrawatch-uninstall.log on the host for post-mortem inspection.
func RunUninstall(ctx context.Context, configJSON string, progressFn func(chunk string)) *agentv1.AgentTaskResult {
	_ = configJSON // reserved for future flags

	binPath, err := os.Executable()
	if err != nil {
		return errorResult(fmt.Sprintf("cannot determine agent binary path: %v", err))
	}

	progressFn("Agent uninstall requested.\n")
	progressFn(fmt.Sprintf("Binary: %s\n", binPath))
	progressFn("Spawning detached uninstaller process in 3 seconds.\n")
	progressFn("On systemd hosts the uninstaller is launched as a transient systemd unit (systemd-run) so it survives the agent cgroup being torn down.\n")
	progressFn("The agent service will stop shortly after; uninstaller output is written to /tmp/infrawatch-uninstall.log on the host.\n")

	// Run the launcher in a goroutine so the result below is shipped first.
	go func() {
		time.Sleep(3 * time.Second)
		if err := launchDetachedUninstaller(binPath); err != nil {
			slog.Error("failed to launch detached uninstaller", "err", err)
			return
		}
		slog.Info("detached uninstaller launched", "bin", binPath)
	}()

	payload, _ := json.Marshal(uninstallResult{
		Status: "scheduled",
		Note:   "uninstaller runs in a detached process; agent will exit within seconds",
	})
	return &agentv1.AgentTaskResult{
		ExitCode:   0,
		ResultJson: string(payload),
	}
}
