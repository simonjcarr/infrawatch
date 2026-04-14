//go:build !windows

package tasks

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"
)

const uninstallLogPath = "/tmp/infrawatch-uninstall.log"

// launchDetachedUninstaller spawns the agent binary with -uninstall so it
// survives the service manager terminating the current agent process.
//
// Linux/systemd requires special handling: the agent runs in a systemd cgroup
// with the default KillMode=control-group, so `systemctl stop infrawatch-agent`
// sends SIGTERM to every process in that cgroup — including any children we
// detach via setsid, because cgroup membership is inherited regardless of
// session. We therefore hand the uninstall off to `systemd-run` which creates
// a transient unit in its own cgroup, so it is not affected when the agent's
// cgroup is torn down. If systemd-run is missing (non-systemd Linux) we fall
// back to the setsid path, which at least survives ordinary parent death even
// if it does not survive a systemctl stop.
//
// macOS/launchd tracks processes by pid, not cgroup, so a new session (setsid)
// is sufficient to escape launchd's termination of the agent.
func launchDetachedUninstaller(binPath string) error {
	if runtime.GOOS == "linux" {
		if err := launchViaSystemdRun(binPath); err == nil {
			return nil
		}
		// fall through to setsid fallback
	}
	return launchViaSetsid(binPath)
}

// launchViaSystemdRun registers a transient systemd service that runs the
// uninstaller. --no-block returns once systemd has accepted the job, --collect
// ensures the unit is garbage-collected after it exits so repeat invocations
// don't collide. A shell wrapper is used so we can redirect stdout/stderr to
// the log file (systemd-run doesn't proxy the caller's stdio to the grandchild).
func launchViaSystemdRun(binPath string) error {
	cmd := exec.Command(
		"systemd-run",
		"--no-block",
		"--collect",
		"--description=Infrawatch agent self-uninstall",
		"/bin/sh", "-c",
		fmt.Sprintf("exec %s -uninstall >%s 2>&1", binPath, uninstallLogPath),
	)
	// Inherit stdio so the (brief) systemd-run output appears in the agent log.
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// launchViaSetsid is the non-systemd fallback: start the uninstaller in a new
// session and return immediately. Sufficient on macOS and non-systemd Linux.
func launchViaSetsid(binPath string) error {
	logFile, err := os.OpenFile(uninstallLogPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		// Logging is best-effort — don't abort the uninstall just because
		// we can't open a log file (unusual but possible on read-only /tmp).
		logFile = nil
	}

	cmd := exec.Command(binPath, "-uninstall")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}

	if err := cmd.Start(); err != nil {
		if logFile != nil {
			_ = logFile.Close()
		}
		return fmt.Errorf("starting uninstaller: %w", err)
	}
	// Intentionally do not Wait — the child runs independently and this
	// process is about to be terminated by the service manager.
	return nil
}
