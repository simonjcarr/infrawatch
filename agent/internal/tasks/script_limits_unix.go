//go:build !windows

package tasks

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

const (
	scriptMemoryLimitKB   = 1_048_576
	scriptMaxFileBlocks   = 20_480
	scriptMaxProcesses    = 32
	scriptMaxOpenFiles    = 128
	scriptTimeoutHeadroom = 5 * time.Second
)

func buildScriptCommand(ctx context.Context, interpreter, scriptPath string, timeout time.Duration, hasTimeout bool) (*exec.Cmd, error) {
	if _, err := exec.LookPath("sh"); err != nil {
		return nil, fmt.Errorf("required bootstrap shell %q not found on this host: %v", "sh", err)
	}

	cpuLimitSnippet := ""
	if hasTimeout {
		cpuLimitSnippet = `ulimit -t "$CT_OPS_SCRIPT_CPU_SECONDS"`
	}

	cmd := exec.CommandContext(ctx, "sh", "-c", `
`+cpuLimitSnippet+`
ulimit -f "$CT_OPS_SCRIPT_FILE_BLOCKS"
ulimit -u "$CT_OPS_SCRIPT_MAX_PROCS"
ulimit -n "$CT_OPS_SCRIPT_MAX_NOFILE"
ulimit -v "$CT_OPS_SCRIPT_MEMORY_KB" 2>/dev/null || true
exec "$1" "$2"
`, "sh", interpreter, scriptPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if hasTimeout {
		cmd.Env = append(cmd.Env,
			"CT_OPS_SCRIPT_CPU_SECONDS="+strconv.Itoa(int((timeout+scriptTimeoutHeadroom)/time.Second)),
		)
	}
	cmd.Env = append(cmd.Env,
		"CT_OPS_SCRIPT_FILE_BLOCKS="+strconv.Itoa(scriptMaxFileBlocks),
		"CT_OPS_SCRIPT_MAX_PROCS="+strconv.Itoa(scriptMaxProcesses),
		"CT_OPS_SCRIPT_MAX_NOFILE="+strconv.Itoa(scriptMaxOpenFiles),
		"CT_OPS_SCRIPT_MEMORY_KB="+strconv.Itoa(scriptMemoryLimitKB),
	)
	return cmd, nil
}
