package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

func init() {
	Register("service", RunServiceAction)
}

// serviceConfig is the JSON structure stored in task_runs.config for service tasks.
type serviceConfig struct {
	ServiceName string `json:"service_name"`
	Action      string `json:"action"` // "start" | "stop" | "restart" | "status"
}

// serviceResult is the JSON structure stored in task_run_hosts.result for service tasks.
type serviceResult struct {
	ServiceName string `json:"service_name"`
	Action      string `json:"action"`
	IsActive    bool   `json:"is_active"`
}

var validServiceActions = map[string]bool{
	"start":   true,
	"stop":    true,
	"restart": true,
	"status":  true,
}

// RunServiceAction runs a systemctl action against the named service and reports
// the service's active state after the action completes.
func RunServiceAction(ctx context.Context, configJSON string, progressFn func(chunk string)) *agentv1.AgentTaskResult {
	var cfg serviceConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return errorResult(fmt.Sprintf("invalid service config: %v", err))
	}
	if cfg.ServiceName == "" {
		return errorResult("service_name is required")
	}
	if !validServiceActions[cfg.Action] {
		return errorResult(fmt.Sprintf("invalid action %q: must be one of start, stop, restart, status", cfg.Action))
	}

	// Service operations should be fast; cap at 60 seconds.
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	progressFn(fmt.Sprintf("Running: systemctl %s %s\n\n", cfg.Action, cfg.ServiceName))

	cmd := exec.CommandContext(ctx, "systemctl", cfg.Action, cfg.ServiceName)
	exitCode, _, runErr := runCommandStreaming(ctx, cmd, progressFn)

	if runErr != nil {
		if exitCode == -1 {
			// Command could not start — systemctl not available or similar.
			return errorResult(runErr.Error())
		}
	}

	// Check whether the service is currently active regardless of the action
	// result, so the UI can reflect the live state.
	isActive := checkServiceActive(cfg.ServiceName)

	if isActive {
		progressFn(fmt.Sprintf("\nService %s is active (running).\n", cfg.ServiceName))
	} else {
		progressFn(fmt.Sprintf("\nService %s is inactive (dead).\n", cfg.ServiceName))
	}

	result := serviceResult{
		ServiceName: cfg.ServiceName,
		Action:      cfg.Action,
		IsActive:    isActive,
	}
	resultJSON, _ := json.Marshal(result)

	return &agentv1.AgentTaskResult{
		ExitCode:   int32(exitCode),
		ResultJson: string(resultJSON),
	}
}

// checkServiceActive returns true if the named service is currently active
// according to systemctl is-active.
func checkServiceActive(serviceName string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", serviceName)
	return cmd.Run() == nil
}
