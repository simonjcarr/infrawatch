// Package install handles self-installation of the agent as a system service.
package install

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	agentconfig "github.com/infrawatch/agent/internal/config"
)

// Run performs a full system installation for the current OS.
// It must be called as root (Linux/macOS) or Administrator (Windows).
// orgToken is required. ingestAddress is optional — pass empty string to keep the existing value.
// tlsSkipVerify disables TLS certificate verification; use when ingest uses a self-signed cert.
func Run(orgToken, ingestAddress string, tlsSkipVerify bool) error {
	switch runtime.GOOS {
	case "linux":
		return installLinux(orgToken, ingestAddress, tlsSkipVerify)
	case "darwin":
		return installDarwin(orgToken, ingestAddress, tlsSkipVerify)
	case "windows":
		return installWindows(orgToken, ingestAddress, tlsSkipVerify)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// mergeConfig loads the existing config at cfgPath (if present), then overlays
// any explicitly provided flag values on top. This preserves fields like
// ca_cert_file and tls_skip_verify across reinstalls.
// orgToken is always applied. ingestAddress and tlsSkipVerify are only applied if non-zero.
func mergeConfig(cfgPath, orgToken, ingestAddress, defaultDataDir string, tlsSkipVerify bool) *agentconfig.Config {
	cfg, err := agentconfig.Load(cfgPath)
	if err != nil {
		// File missing or unparseable — start from scratch with caller-supplied defaults.
		cfg = &agentconfig.Config{
			Ingest: agentconfig.IngestConfig{
				Address: "localhost:9443",
			},
			Agent: agentconfig.AgentConfig{
				DataDir:               defaultDataDir,
				HeartbeatIntervalSecs: 30,
			},
		}
	} else {
		slog.Info("existing config found, preserving settings", "path", cfgPath)
		backupConfig(cfgPath)
	}

	cfg.Agent.OrgToken = orgToken
	if ingestAddress != "" {
		cfg.Ingest.Address = ingestAddress
	}
	if tlsSkipVerify {
		cfg.Ingest.TLSSkipVerify = true
	}

	return cfg
}

// backupConfig copies cfgPath to cfgPath.<timestamp>.bak so the user can recover it.
func backupConfig(cfgPath string) {
	bak := fmt.Sprintf("%s.%s.bak", cfgPath, time.Now().UTC().Format("20060102T150405Z"))
	src, err := os.Open(cfgPath)
	if err != nil {
		return
	}
	defer src.Close()
	dst, err := os.OpenFile(bak, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err == nil {
		slog.Info("existing config backed up", "backup", bak)
	}
}

// ── Linux / systemd ───────────────────────────────────────────────────────────

func installLinux(orgToken, ingestAddress string, tlsSkipVerify bool) error {
	if os.Getuid() != 0 {
		return fmt.Errorf("install must be run as root (try: sudo ./infrawatch-agent --install ...)")
	}

	const dest = "/usr/local/bin/infrawatch-agent"
	const cfgPath = "/etc/infrawatch/agent.toml"
	const dataDir = "/var/lib/infrawatch/agent"

	if err := copyBinary(dest); err != nil {
		return fmt.Errorf("copying binary: %w", err)
	}
	if err := mkdirs("/etc/infrawatch", dataDir); err != nil {
		return fmt.Errorf("creating directories: %w", err)
	}
	cfg := mergeConfig(cfgPath, orgToken, ingestAddress, dataDir, tlsSkipVerify)
	if err := writeConfig(cfgPath, cfg); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}

	unit := `[Unit]
Description=Infrawatch Agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/infrawatch-agent -config /etc/infrawatch/agent.toml
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`
	if err := writeFile("/etc/systemd/system/infrawatch-agent.service", unit, 0o644); err != nil {
		return fmt.Errorf("writing systemd unit: %w", err)
	}

	for _, args := range [][]string{
		{"systemctl", "daemon-reload"},
		{"systemctl", "enable", "--now", "infrawatch-agent"},
	} {
		if err := run(args[0], args[1:]...); err != nil {
			return fmt.Errorf("running %v: %w", args, err)
		}
	}

	printSuccess("systemctl status infrawatch-agent", "journalctl -u infrawatch-agent -f")
	return nil
}

// ── macOS / launchd ───────────────────────────────────────────────────────────

func installDarwin(orgToken, ingestAddress string, tlsSkipVerify bool) error {
	if os.Getuid() != 0 {
		return fmt.Errorf("install must be run as root (try: sudo ./infrawatch-agent --install ...)")
	}

	const dest = "/usr/local/bin/infrawatch-agent"
	const cfgPath = "/etc/infrawatch/agent.toml"
	const dataDir = "/var/lib/infrawatch/agent"
	const plistPath = "/Library/LaunchDaemons/com.infrawatch.agent.plist"

	if err := copyBinary(dest); err != nil {
		return fmt.Errorf("copying binary: %w", err)
	}
	if err := mkdirs("/etc/infrawatch", dataDir, "/var/log"); err != nil {
		return fmt.Errorf("creating directories: %w", err)
	}
	cfg := mergeConfig(cfgPath, orgToken, ingestAddress, dataDir, tlsSkipVerify)
	if err := writeConfig(cfgPath, cfg); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}

	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.infrawatch.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/infrawatch-agent</string>
        <string>-config</string>
        <string>/etc/infrawatch/agent.toml</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/infrawatch-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/infrawatch-agent.log</string>
</dict>
</plist>
`
	if err := writeFile(plistPath, plist, 0o644); err != nil {
		return fmt.Errorf("writing launchd plist: %w", err)
	}

	if err := run("launchctl", "load", "-w", plistPath); err != nil {
		return fmt.Errorf("loading launchd service: %w", err)
	}

	printSuccess(
		"launchctl list com.infrawatch.agent",
		"tail -f /var/log/infrawatch-agent.log",
	)
	return nil
}

// ── Windows / Service Control Manager ────────────────────────────────────────

func installWindows(orgToken, ingestAddress string, tlsSkipVerify bool) error {
	if !isAdmin() {
		return fmt.Errorf("install must be run as Administrator")
	}

	binDir := filepath.Join(`C:\Program Files`, "infrawatch")
	cfgDir := filepath.Join(`C:\ProgramData`, "infrawatch")
	dataDir := filepath.Join(cfgDir, "agent")
	dest := filepath.Join(binDir, "infrawatch-agent.exe")
	cfgFile := filepath.Join(cfgDir, "agent.toml")

	if err := mkdirs(binDir, cfgDir, dataDir); err != nil {
		return fmt.Errorf("creating directories: %w", err)
	}
	if err := copyBinary(dest); err != nil {
		return fmt.Errorf("copying binary: %w", err)
	}
	cfg := mergeConfig(cfgFile, orgToken, ingestAddress, dataDir, tlsSkipVerify)
	if err := writeConfig(cfgFile, cfg); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}

	binPath := fmt.Sprintf(`"%s" -config "%s"`, dest, cfgFile)
	if err := run("sc.exe", "create", "InfrawatchAgent",
		"binPath=", binPath,
		"DisplayName=", "Infrawatch Agent",
		"start=", "auto",
	); err != nil {
		return fmt.Errorf("creating Windows service: %w", err)
	}
	if err := run("sc.exe", "description", "InfrawatchAgent",
		"Infrawatch infrastructure monitoring agent",
	); err != nil {
		// Non-fatal — description is cosmetic
		slog.Warn("setting service description", "err", err)
	}
	if err := run("sc.exe", "start", "InfrawatchAgent"); err != nil {
		return fmt.Errorf("starting Windows service: %w", err)
	}

	printSuccess("sc query InfrawatchAgent", `Get-EventLog -LogName Application -Source InfrawatchAgent`)
	return nil
}

// isAdmin returns true if the process has administrator/root privileges.
// On Windows, attempts to open a handle that requires admin rights.
// On Linux/macOS this function is never called (Getuid check is used instead).
func isAdmin() bool {
	f, err := os.Open(`\\.\PHYSICALDRIVE0`)
	if err != nil {
		return false
	}
	f.Close()
	return true
}

// ── Shared helpers ────────────────────────────────────────────────────────────

func copyBinary(dest string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving current executable: %w", err)
	}

	src, err := os.Open(exe)
	if err != nil {
		return fmt.Errorf("opening source binary: %w", err)
	}
	defer src.Close()

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}

	dst, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return fmt.Errorf("creating destination: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copying binary data: %w", err)
	}

	slog.Info("binary installed", "path", dest)
	return nil
}

func mkdirs(dirs ...string) error {
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	return nil
}

func writeConfig(path string, cfg *agentconfig.Config) error {
	var b strings.Builder

	b.WriteString("[ingest]\n")
	b.WriteString(fmt.Sprintf("address = %q\n", cfg.Ingest.Address))
	if cfg.Ingest.CACertFile != "" {
		b.WriteString(fmt.Sprintf("ca_cert_file = %q\n", cfg.Ingest.CACertFile))
	}
	if cfg.Ingest.TLSSkipVerify {
		b.WriteString("tls_skip_verify = true\n")
	}

	b.WriteString("\n[agent]\n")
	b.WriteString(fmt.Sprintf("org_token = %q\n", cfg.Agent.OrgToken))
	b.WriteString(fmt.Sprintf("data_dir   = %q\n", cfg.Agent.DataDir))
	if cfg.Agent.HeartbeatIntervalSecs > 0 && cfg.Agent.HeartbeatIntervalSecs != 30 {
		b.WriteString(fmt.Sprintf("heartbeat_interval_secs = %d\n", cfg.Agent.HeartbeatIntervalSecs))
	}

	if err := writeFile(path, b.String(), 0o600); err != nil {
		return err
	}
	slog.Info("config written", "path", path)
	return nil
}

func writeFile(path, content string, mode os.FileMode) error {
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		return err
	}
	slog.Info("file written", "path", path)
	return nil
}

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...) //nolint:gosec
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func printSuccess(statusCmd, logsCmd string) {
	fmt.Println()
	fmt.Println("Infrawatch agent installed and started.")
	fmt.Printf("Check status:  %s\n", statusCmd)
	fmt.Printf("View logs:     %s\n", logsCmd)
}
