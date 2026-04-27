//go:build windows

package tasks

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

func buildScriptCommand(_ context.Context, _, _ string, _ time.Duration) (*exec.Cmd, error) {
	return nil, fmt.Errorf("custom_script tasks are disabled on Windows until sandboxing is implemented")
}
