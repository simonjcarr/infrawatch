// Package install handles self-installation of the agent as a system service.
package install

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
)

const (
	destBinary  = "/usr/local/bin/infrawatch-agent"
	configDir   = "/etc/infrawatch"
	configFile  = "/etc/infrawatch/agent.toml"
	dataDir     = "/var/lib/infrawatch/agent"
	systemdUnit = "/etc/systemd/system/infrawatch-agent.service"
)

// Run performs a full system installation:
//   - Verifies the process is running as root
//   - Copies the running binary to /usr/local/bin/infrawatch-agent
//   - Creates required directories
//   - Writes /etc/infrawatch/agent.toml with orgToken and ingestAddress
//   - Writes /etc/systemd/system/infrawatch-agent.service
//   - Runs: systemctl daemon-reload && systemctl enable --now infrawatch-agent
func Run(orgToken, ingestAddress string) error {
	if os.Getuid() != 0 {
		return fmt.Errorf("install must be run as root (try: sudo ./infrawatch-agent --install ...)")
	}

	if err := copyBinary(); err != nil {
		return fmt.Errorf("copying binary: %w", err)
	}

	if err := createDirs(); err != nil {
		return fmt.Errorf("creating directories: %w", err)
	}

	if err := writeConfig(orgToken, ingestAddress); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}

	if err := writeSystemdUnit(); err != nil {
		return fmt.Errorf("writing systemd unit: %w", err)
	}

	if err := enableService(); err != nil {
		return fmt.Errorf("enabling service: %w", err)
	}

	slog.Info("agent installed successfully",
		"binary", destBinary,
		"config", configFile,
		"service", "infrawatch-agent",
	)
	fmt.Println()
	fmt.Println("Infrawatch agent installed and started.")
	fmt.Println("Check status:  systemctl status infrawatch-agent")
	fmt.Println("View logs:     journalctl -u infrawatch-agent -f")

	return nil
}

func copyBinary() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving current executable: %w", err)
	}

	src, err := os.Open(exe)
	if err != nil {
		return fmt.Errorf("opening source binary: %w", err)
	}
	defer src.Close()

	dst, err := os.OpenFile(destBinary, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return fmt.Errorf("creating destination binary: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copying binary data: %w", err)
	}

	slog.Info("binary installed", "path", destBinary)
	return nil
}

func createDirs() error {
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	return nil
}

func writeConfig(orgToken, ingestAddress string) error {
	content := fmt.Sprintf(`[ingest]
address = %q

[agent]
org_token = %q
data_dir   = %q
`, ingestAddress, orgToken, dataDir)

	if err := os.WriteFile(configFile, []byte(content), 0o600); err != nil {
		return err
	}
	slog.Info("config written", "path", configFile)
	return nil
}

func writeSystemdUnit() error {
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
	if err := os.WriteFile(systemdUnit, []byte(unit), 0o644); err != nil {
		return err
	}
	slog.Info("systemd unit written", "path", systemdUnit)
	return nil
}

func enableService() error {
	cmds := [][]string{
		{"systemctl", "daemon-reload"},
		{"systemctl", "enable", "--now", "infrawatch-agent"},
	}
	for _, args := range cmds {
		cmd := exec.Command(args[0], args[1:]...) //nolint:gosec
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("running %v: %w", args, err)
		}
	}
	return nil
}
