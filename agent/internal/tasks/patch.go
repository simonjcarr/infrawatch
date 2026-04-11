package tasks

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

func init() {
	Register("patch", RunPatch)
}

// patchConfig is the JSON structure stored in task_runs.config for patch tasks.
type patchConfig struct {
	Mode string `json:"mode"` // "security" | "all"
}

// patchResult is the JSON structure stored in task_run_hosts.result for patch tasks.
type patchResult struct {
	PackagesUpdated []packageUpdate `json:"packages_updated"`
	RebootRequired  bool            `json:"reboot_required"`
}

type packageUpdate struct {
	Name        string `json:"name"`
	FromVersion string `json:"from_version"`
	ToVersion   string `json:"to_version"`
}

// RunPatch detects the host's package manager, runs the appropriate upgrade
// command for the given mode, and returns a structured result.
func RunPatch(ctx context.Context, configJSON string, progressFn func(chunk string)) *agentv1.AgentTaskResult {
	var cfg patchConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return errorResult(fmt.Sprintf("invalid patch config: %v", err))
	}
	if cfg.Mode == "" {
		cfg.Mode = "all"
	}

	pm, err := detectPackageManager()
	if err != nil {
		return errorResult(err.Error())
	}

	cmd, err := buildPatchCommand(pm, cfg.Mode)
	if err != nil {
		return errorResult(err.Error())
	}

	exitCode, rawOutput, runErr := runCommandStreaming(ctx, cmd, progressFn)
	if runErr != nil && exitCode == 0 {
		// command couldn't start at all
		return errorResult(runErr.Error())
	}

	result := patchResult{
		PackagesUpdated: parsePackages(pm, rawOutput),
		RebootRequired:  checkRebootRequired(),
	}
	resultJSON, _ := json.Marshal(result)

	return &agentv1.AgentTaskResult{
		ExitCode:   int32(exitCode),
		ResultJson: string(resultJSON),
	}
}

// detectPackageManager probes for known Linux package managers in order of
// preference: apt → dnf → yum → zypper.
func detectPackageManager() (string, error) {
	for _, pm := range []string{"apt-get", "dnf", "yum", "zypper"} {
		if _, err := exec.LookPath(pm); err == nil {
			if pm == "apt-get" {
				return "apt", nil
			}
			return pm, nil
		}
	}
	return "", fmt.Errorf("no supported package manager found (apt/dnf/yum/zypper)")
}

// buildPatchCommand returns an *exec.Cmd for the given package manager and mode.
func buildPatchCommand(pm, mode string) (*exec.Cmd, error) {
	switch pm {
	case "apt":
		if mode == "security" {
			// Install only security-flagged upgrades via unattended-upgrades.
			// Fall back to a targeted approach if unattended-upgrades is absent.
			if _, err := exec.LookPath("unattended-upgrade"); err == nil {
				return exec.Command("unattended-upgrade", "-v"), nil
			}
			// Fallback: use apt-get with the security origin filter
			return exec.Command("bash", "-c",
				`apt-get install -y --only-upgrade $(apt-get --just-print upgrade 2>/dev/null | `+
					`grep -i "^Inst" | grep -i securi | awk '{print $2}' | head -200)`), nil
		}
		return exec.Command("apt-get", "upgrade", "-y"), nil

	case "dnf":
		if mode == "security" {
			return exec.Command("dnf", "update", "--security", "-y"), nil
		}
		return exec.Command("dnf", "upgrade", "-y"), nil

	case "yum":
		if mode == "security" {
			return exec.Command("yum", "update", "--security", "-y"), nil
		}
		return exec.Command("yum", "upgrade", "-y"), nil

	case "zypper":
		if mode == "security" {
			return exec.Command("zypper", "patch", "--category", "security", "-y"), nil
		}
		return exec.Command("zypper", "patch", "-y"), nil
	}

	return nil, fmt.Errorf("unsupported package manager: %s", pm)
}

// runCommandStreaming runs cmd, streaming stdout+stderr to progressFn in line
// batches. Returns the exit code and the full combined output.
func runCommandStreaming(ctx context.Context, cmd *exec.Cmd, progressFn func(chunk string)) (exitCode int, rawOutput string, err error) {
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")

	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		return -1, "", fmt.Errorf("starting command: %w", err)
	}

	// Collect output line-by-line, forwarding batches to progressFn.
	var sb strings.Builder
	scanner := bufio.NewScanner(pr)
	var batch strings.Builder
	lineCount := 0

	for scanner.Scan() {
		line := scanner.Text() + "\n"
		sb.WriteString(line)
		batch.WriteString(line)
		lineCount++
		if lineCount >= 10 {
			progressFn(batch.String())
			batch.Reset()
			lineCount = 0
		}
	}
	// Flush remaining lines
	if batch.Len() > 0 {
		progressFn(batch.String())
	}

	pw.Close()

	if waitErr := cmd.Wait(); waitErr != nil {
		if exitErr, ok := waitErr.(*exec.ExitError); ok {
			return exitErr.ExitCode(), sb.String(), nil
		}
		return -1, sb.String(), waitErr
	}
	return 0, sb.String(), nil
}

// checkRebootRequired returns true if the host has flagged that a reboot is
// needed after patching. Checks the standard locations for Debian/Ubuntu and
// a common dnf/yum reboot check.
func checkRebootRequired() bool {
	// Debian / Ubuntu
	if _, err := os.Stat("/var/run/reboot-required"); err == nil {
		return true
	}
	// RHEL / Fedora via needs-restarting
	if _, err := exec.LookPath("needs-restarting"); err == nil {
		cmd := exec.Command("needs-restarting", "-r")
		if err := cmd.Run(); err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
				return true
			}
		}
	}
	return false
}

// parsePackages attempts to extract a list of updated packages from the raw
// command output. Returns an empty slice if parsing is not possible for the
// given package manager.
func parsePackages(pm, rawOutput string) []packageUpdate {
	switch pm {
	case "apt":
		return parseAptPackages(rawOutput)
	case "dnf", "yum":
		return parseRpmPackages(rawOutput)
	}
	return nil
}

// parseAptPackages extracts "Unpacking <pkg> (<new>) over (<old>)" lines.
func parseAptPackages(output string) []packageUpdate {
	var updates []packageUpdate
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Unpacking ") {
			continue
		}
		// "Unpacking libssl1.1:amd64 (1.1.1f-1ubuntu2.21) over (1.1.1f-1ubuntu2.20) ..."
		parts := strings.Fields(line)
		if len(parts) < 5 {
			continue
		}
		name := strings.Split(parts[1], ":")[0]
		toVer := strings.Trim(parts[2], "()")
		fromVer := strings.Trim(parts[4], "()")
		updates = append(updates, packageUpdate{Name: name, FromVersion: fromVer, ToVersion: toVer})
	}
	return updates
}

// parseRpmPackages extracts "  <pkg>  <arch>  <version>  <repo>" lines from
// the "Upgraded:" section of yum/dnf output.
func parseRpmPackages(output string) []packageUpdate {
	var updates []packageUpdate
	inUpgraded := false
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "Upgraded:") || strings.HasPrefix(trimmed, "Upgrading:") {
			inUpgraded = true
			continue
		}
		if inUpgraded {
			if trimmed == "" || (len(trimmed) > 0 && trimmed[0] != ' ' && !strings.HasPrefix(line, " ")) {
				inUpgraded = false
				continue
			}
			parts := strings.Fields(trimmed)
			if len(parts) >= 1 {
				name := strings.Split(parts[0], ".")[0] // strip arch suffix
				ver := ""
				if len(parts) >= 3 {
					ver = parts[2]
				}
				updates = append(updates, packageUpdate{Name: name, ToVersion: ver})
			}
		}
	}
	return updates
}

func errorResult(msg string) *agentv1.AgentTaskResult {
	return &agentv1.AgentTaskResult{
		ExitCode: -1,
		Error:    msg,
	}
}
