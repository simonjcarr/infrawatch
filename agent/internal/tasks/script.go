package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func init() {
	Register("custom_script", RunCustomScript)
}

const (
	maxScriptTimeout = time.Hour
)

var allowedScriptInterpreters = map[string]struct{}{
	"sh":      {},
	"bash":    {},
	"python3": {},
}

// scriptConfig is the JSON structure stored in task_runs.config for custom_script tasks.
type scriptConfig struct {
	Script         string `json:"script"`          // script body to execute
	Interpreter    string `json:"interpreter"`     // "sh" | "bash" | "python3" (default: "sh")
	TimeoutSeconds int    `json:"timeout_seconds"` // 0 = inherit parent context (45 min agent default)
}

// scriptResult is the JSON structure stored in task_run_hosts.result for custom_script tasks.
type scriptResult struct {
	ExitCode int `json:"exit_code"`
}

// RunCustomScript writes the script to a temp file and executes it with the
// specified interpreter, streaming stdout+stderr back in real time.
func RunCustomScript(ctx context.Context, configJSON string, progressFn func(chunk string)) *agentv1.AgentTaskResult {
	var cfg scriptConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return errorResult(fmt.Sprintf("invalid script config: %v", err))
	}
	if cfg.Script == "" {
		return errorResult("script body is required")
	}
	if cfg.Interpreter == "" {
		cfg.Interpreter = "sh"
	}
	if _, ok := allowedScriptInterpreters[cfg.Interpreter]; !ok {
		return errorResult(fmt.Sprintf("interpreter %q is not permitted", cfg.Interpreter))
	}

	timeout, hasTimeout := effectiveScriptTimeout(cfg.TimeoutSeconds)
	if hasTimeout {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	// Verify the interpreter is available before writing the temp file.
	if _, err := exec.LookPath(cfg.Interpreter); err != nil {
		return errorResult(fmt.Sprintf("interpreter %q not found on this host: %v", cfg.Interpreter, err))
	}

	// Write the script body to a temp file and make it executable.
	tmpFile, err := os.CreateTemp("", "ct-ops-script-*")
	if err != nil {
		return errorResult(fmt.Sprintf("failed to create temp file: %v", err))
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath) // clean up regardless of outcome

	if _, err := tmpFile.WriteString(cfg.Script); err != nil {
		_ = tmpFile.Close()
		return errorResult(fmt.Sprintf("failed to write script: %v", err))
	}
	if err := tmpFile.Close(); err != nil {
		return errorResult(fmt.Sprintf("failed to finalise temp file: %v", err))
	}
	if err := os.Chmod(tmpPath, 0o700); err != nil {
		return errorResult(fmt.Sprintf("failed to set script permissions: %v", err))
	}

	timeoutLabel := "inherited"
	if hasTimeout {
		timeoutLabel = timeout.String()
	}
	progressFn(fmt.Sprintf("Running script with interpreter: %s (timeout: %s)\n\n", cfg.Interpreter, timeoutLabel))

	cmd, err := buildScriptCommand(ctx, cfg.Interpreter, tmpPath, timeout, hasTimeout)
	if err != nil {
		return errorResult(err.Error())
	}
	exitCode, _, runErr := runCommandStreaming(ctx, cmd, progressFn)

	if runErr != nil {
		if errors.Is(runErr, context.Canceled) {
			return &agentv1.AgentTaskResult{
				ExitCode: int32(exitCode),
				Error:    "cancelled by user",
			}
		}
		if errors.Is(runErr, context.DeadlineExceeded) {
			return &agentv1.AgentTaskResult{
				ExitCode: int32(exitCode),
				Error:    fmt.Sprintf("task timed out (exceeded %s)", timeout),
			}
		}
		if exitCode == -1 {
			// Command could not start.
			return errorResult(runErr.Error())
		}
	}

	result := scriptResult{ExitCode: exitCode}
	resultJSON, _ := json.Marshal(result)

	return &agentv1.AgentTaskResult{
		ExitCode:   int32(exitCode),
		ResultJson: string(resultJSON),
	}
}

func effectiveScriptTimeout(timeoutSeconds int) (time.Duration, bool) {
	if timeoutSeconds <= 0 {
		return 0, false
	}
	timeout := time.Duration(timeoutSeconds) * time.Second
	if timeout > maxScriptTimeout {
		return maxScriptTimeout, true
	}
	return timeout, true
}
