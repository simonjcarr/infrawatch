//go:build linux

package heartbeat

import (
	"os"
	"strings"
	"syscall"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// readAllDisks reads /proc/mounts and calls syscall.Statfs on each real filesystem.
func readAllDisks() []*agentv1.DiskInfo {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var result []*agentv1.DiskInfo

	for _, line := range splitLines(string(data)) {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		device, mountPoint, fsType := fields[0], fields[1], fields[2]

		if pseudoFSTypes[fsType] {
			continue
		}
		if seen[mountPoint] {
			continue
		}
		seen[mountPoint] = true

		var stat syscall.Statfs_t
		if err := syscall.Statfs(mountPoint, &stat); err != nil {
			continue
		}
		if stat.Blocks == 0 {
			continue
		}

		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bfree * uint64(stat.Bsize)
		used := total - free
		var pct float32
		if total > 0 {
			pct = float32(used) / float32(total) * 100
		}

		result = append(result, &agentv1.DiskInfo{
			MountPoint:  mountPoint,
			Device:      device,
			FsType:      fsType,
			TotalBytes:  total,
			UsedBytes:   used,
			FreeBytes:   free,
			PercentUsed: pct,
		})
	}
	return result
}
