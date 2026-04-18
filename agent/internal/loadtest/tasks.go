package loadtest

import (
	"context"
	"fmt"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// simulateTask emits 2-4 fake progress chunks spread over a few seconds, then
// a final exit-0 result. If the task type looks like a software-inventory
// scan, it additionally opens a SubmitSoftwareInventory stream.
func (v *VirtualAgent) simulateTask(ctx context.Context, client agentv1.IngestServiceClient, t *agentv1.AgentTask) {
	chunks := 2 + v.rng.Intn(3)
	for i := 0; i < chunks; i++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(500+v.rng.Intn(1500)) * time.Millisecond):
		}
		v.mu.Lock()
		v.pendingProgress = append(v.pendingProgress, &agentv1.AgentTaskProgress{
			TaskId:      t.TaskId,
			OutputChunk: fmt.Sprintf("[loadtest] task %s progress chunk %d/%d\n", t.TaskId, i+1, chunks),
		})
		v.mu.Unlock()
	}

	if v.cfg.SimulateInventory && t.TaskType == "software_inventory_scan" {
		v.simulateInventoryStream(ctx, client, t.TaskId)
	}

	v.mu.Lock()
	v.pendingResults = append(v.pendingResults, &agentv1.AgentTaskResult{
		TaskId:     t.TaskId,
		TaskType:   t.TaskType,
		ExitCode:   0,
		ResultJson: `{"source":"loadtest","ok":true}`,
	})
	v.mu.Unlock()
}
