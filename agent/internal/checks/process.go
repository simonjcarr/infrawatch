package checks

import (
	"fmt"
	"os"
	"strings"
)

// ProcessConfig is the JSON config for a process check.
type ProcessConfig struct {
	ProcessName string `json:"process_name"`
}

func runProcessCheck(cfg ProcessConfig) (status, output string) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return "error", fmt.Sprintf("reading /proc: %v", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if !isNumeric(entry.Name()) {
			continue
		}
		pid := entry.Name()

		// Check comm (first 15 chars of process name)
		if comm, err := os.ReadFile("/proc/" + pid + "/comm"); err == nil {
			if strings.TrimSpace(string(comm)) == cfg.ProcessName {
				return "pass", fmt.Sprintf("process '%s' found (pid %s)", cfg.ProcessName, pid)
			}
		}

		// Fall back to cmdline for longer names
		if cmdline, err := os.ReadFile("/proc/" + pid + "/cmdline"); err == nil {
			// cmdline is null-separated; take the first segment and basename
			parts := strings.SplitN(string(cmdline), "\x00", 2)
			if len(parts) > 0 {
				name := parts[0]
				// Extract basename
				if idx := strings.LastIndex(name, "/"); idx >= 0 {
					name = name[idx+1:]
				}
				if name == cfg.ProcessName {
					return "pass", fmt.Sprintf("process '%s' found (pid %s)", cfg.ProcessName, pid)
				}
			}
		}
	}

	return "fail", fmt.Sprintf("process '%s' not found", cfg.ProcessName)
}

func isNumeric(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(s) > 0
}
