// Package tasks provides a generic agent task execution framework.
// Tasks are dispatched by the server via the HeartbeatResponse.pending_task field
// and results are reported back via HeartbeatRequest.task_results.
//
// To add a new task type, register a HandlerFunc in the init() of the
// type-specific file (e.g. patch.go) by calling Register.
package tasks

import (
	"context"
	"fmt"
	"log/slog"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// HandlerFunc is the signature for a task handler.
// configJSON is the raw JSON from task_runs.config.
// progressFn should be called with incremental stdout/stderr chunks; it is
// safe to call from any goroutine and must not block.
type HandlerFunc func(ctx context.Context, configJSON string, progressFn func(chunk string)) *agentv1.AgentTaskResult

var registry = map[string]HandlerFunc{}

// Register adds a handler for the given task_type. Called from init() in each
// task-type file so registration is automatic on import.
func Register(taskType string, fn HandlerFunc) {
	registry[taskType] = fn
}

// taskContextKey is the unexported type used for context values injected by Dispatch.
type taskContextKey int

const (
	taskIDContextKey    taskContextKey = iota
)

// TaskIDFromContext returns the task_run_hosts.id injected by Dispatch into
// the handler's context. Returns "" if not present.
func TaskIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(taskIDContextKey).(string)
	return v
}

// Dispatch executes the task synchronously in the caller's goroutine.
// progressFn is forwarded to the handler for incremental output reporting.
// If no handler is registered for the task type, an error result is returned.
func Dispatch(ctx context.Context, task *agentv1.AgentTask, progressFn func(chunk string)) *agentv1.AgentTaskResult {
	handler, ok := registry[task.TaskType]
	if !ok {
		slog.Warn("no handler registered for task type", "task_type", task.TaskType, "task_id", task.TaskId)
		return &agentv1.AgentTaskResult{
			TaskId:   task.TaskId,
			TaskType: task.TaskType,
			ExitCode: -1,
			Error:    fmt.Sprintf("unsupported task type: %s", task.TaskType),
		}
	}

	// Inject task_id so handlers that open their own gRPC streams
	// (e.g. software_inventory) can use it as a scan/correlation ID.
	ctx = context.WithValue(ctx, taskIDContextKey, task.TaskId)

	slog.Info("executing task", "task_id", task.TaskId, "task_type", task.TaskType)
	result := handler(ctx, task.ConfigJson, progressFn)
	result.TaskId = task.TaskId
	result.TaskType = task.TaskType
	slog.Info("task finished", "task_id", task.TaskId, "task_type", task.TaskType, "exit_code", result.ExitCode)
	return result
}
