package install

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
)

// Uninstall stops the agent service, removes the binary, service files,
// configuration, and data files for the current OS.
// It must be called as root (Linux/macOS) or Administrator (Windows).
func Uninstall() error {
	switch runtime.GOOS {
	case "linux":
		return uninstallLinux()
	case "darwin":
		return uninstallDarwin()
	case "windows":
		return uninstallWindows()
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// ── Linux / systemd ───────────────────────────────────────────────────────────

func uninstallLinux() error {
	if os.Getuid() != 0 {
		return fmt.Errorf("uninstall must be run as root (try: sudo ./ct-ops-agent -uninstall)")
	}

	const serviceName = "ct-ops-agent"
	const unitPath = "/etc/systemd/system/ct-ops-agent.service"
	const binaryPath = "/usr/local/bin/ct-ops-agent"
	const cfgDir = "/etc/ct-ops"
	const dataDir = "/var/lib/ct-ops"

	// Stop and disable the service (ignore errors — it may not be running)
	slog.Info("stopping service", "name", serviceName)
	_ = run("systemctl", "stop", serviceName)
	_ = run("systemctl", "disable", serviceName)

	// Remove systemd unit and reload
	removeFile(unitPath)
	slog.Info("reloading systemd daemon")
	_ = run("systemctl", "daemon-reload")

	// Remove binary, config, and data
	removeFile(binaryPath)
	removeDir(cfgDir)
	removeDir(dataDir)

	printUninstallSuccess()
	return nil
}

// ── macOS / launchd ───────────────────────────────────────────────────────────

func uninstallDarwin() error {
	if os.Getuid() != 0 {
		return fmt.Errorf("uninstall must be run as root (try: sudo ./ct-ops-agent -uninstall)")
	}

	const plistPath = "/Library/LaunchDaemons/dev.carrtech.ct-ops.agent.plist"
	const binaryPath = "/usr/local/bin/ct-ops-agent"
	const cfgDir = "/etc/ct-ops"
	const dataDir = "/var/lib/ct-ops"
	const logFile = "/var/log/ct-ops-agent.log"

	// Unload the launchd service (ignore errors — it may not be loaded)
	slog.Info("unloading launchd service")
	_ = run("launchctl", "unload", plistPath)

	// Remove plist, binary, config, data, and log
	removeFile(plistPath)
	removeFile(binaryPath)
	removeDir(cfgDir)
	removeDir(dataDir)
	removeFile(logFile)

	printUninstallSuccess()
	return nil
}

// ── Windows / Service Control Manager ────────────────────────────────────────

func uninstallWindows() error {
	if !isAdmin() {
		return fmt.Errorf("uninstall must be run as Administrator")
	}

	binDir := filepath.Join(`C:\Program Files`, "ct-ops")
	cfgDir := filepath.Join(`C:\ProgramData`, "ct-ops")

	// Stop and delete the Windows service (ignore errors — it may not exist)
	slog.Info("stopping Windows service", "name", "CtOpsAgent")
	_ = run("sc.exe", "stop", "CtOpsAgent")
	_ = run("sc.exe", "delete", "CtOpsAgent")

	// Deregister the Application event log source so Windows no longer lists
	// the agent under HKLM\SYSTEM\CurrentControlSet\Services\EventLog\Application.
	if err := removeEventLogSource(); err != nil {
		slog.Warn("removing Windows Event Log source", "err", err)
	}

	// Remove binary directory and config/data directory
	removeDir(binDir)
	removeDir(cfgDir)

	printUninstallSuccess()
	return nil
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func removeFile(path string) {
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			slog.Info("file not found, skipping", "path", path)
		} else {
			slog.Warn("failed to remove file", "path", path, "err", err)
		}
		return
	}
	slog.Info("removed", "path", path)
}

func removeDir(path string) {
	if err := os.RemoveAll(path); err != nil {
		slog.Warn("failed to remove directory", "path", path, "err", err)
		return
	}
	slog.Info("removed", "path", path)
}

func printUninstallSuccess() {
	fmt.Println()
	fmt.Println("CT-Ops agent has been uninstalled.")
	fmt.Println("All service files, configuration, and data have been removed.")
}
