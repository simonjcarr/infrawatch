package loadtest

import (
	"fmt"
	"hash/fnv"
	"math/rand"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// SyntheticMetrics generates plausible-looking CPU/memory/disk/network metrics
// for one virtual agent. Values follow a bounded random walk around a
// per-agent baseline seeded from the agent index, so fleet-wide dashboards
// look heterogeneous instead of a single flat line replicated N times.
type SyntheticMetrics struct {
	cpuPct       float64
	memPct       float64
	diskPct      float64
	uptimeSec    int64
	lastTick     time.Time
	disks        []*agentv1.DiskInfo
	netIfaces    []*agentv1.NetworkInterface
	rng          *rand.Rand
	jitter       float64
	osVersionStr string
	hostname     string
}

// NewSyntheticMetrics builds the initial metric state for the agent at the
// given index. jitter controls the amplitude of the per-tick random walk
// (0 = constant values; 1 = ±5% drift per tick).
func NewSyntheticMetrics(agentIndex int, hostname string, jitter float64) *SyntheticMetrics {
	h := fnv.New32a()
	_, _ = fmt.Fprintf(h, "%d:%s", agentIndex, hostname)
	seed := int64(h.Sum32())
	r := rand.New(rand.NewSource(seed))

	ip := fmt.Sprintf("10.255.%d.%d", (agentIndex>>8)&0xff, agentIndex&0xff)
	mac := fmt.Sprintf("02:00:%02x:%02x:%02x:%02x",
		(agentIndex>>24)&0xff,
		(agentIndex>>16)&0xff,
		(agentIndex>>8)&0xff,
		agentIndex&0xff,
	)

	return &SyntheticMetrics{
		cpuPct:       20 + float64(r.Intn(40)),
		memPct:       30 + float64(r.Intn(40)),
		diskPct:      40 + float64(r.Intn(30)),
		uptimeSec:    int64(3600 + r.Intn(86400*7)),
		lastTick:     time.Now(),
		rng:          r,
		jitter:       jitter,
		osVersionStr: "Loadtest Linux 1.0",
		hostname:     hostname,
		disks: []*agentv1.DiskInfo{
			{MountPoint: "/", Device: "/dev/loadtest-root", FsType: "ext4", TotalBytes: 50 * 1024 * 1024 * 1024},
			{MountPoint: "/var", Device: "/dev/loadtest-var", FsType: "ext4", TotalBytes: 100 * 1024 * 1024 * 1024},
		},
		netIfaces: []*agentv1.NetworkInterface{
			{Name: "eth0", IpAddresses: []string{ip}, MacAddress: mac, IsUp: true},
		},
	}
}

// Tick advances all metric values one step along their random walks and
// returns the current metric snapshot ready to stamp into a HeartbeatRequest.
func (s *SyntheticMetrics) Tick() *Snapshot {
	now := time.Now()
	if !s.lastTick.IsZero() {
		s.uptimeSec += int64(now.Sub(s.lastTick).Seconds())
	}
	s.lastTick = now

	step := s.jitter * 5.0
	s.cpuPct = clamp(s.cpuPct+s.rng.NormFloat64()*step, 1, 99)
	s.memPct = clamp(s.memPct+s.rng.NormFloat64()*step*0.6, 5, 95)
	s.diskPct = clamp(s.diskPct+s.rng.NormFloat64()*step*0.1, 10, 98)

	disks := make([]*agentv1.DiskInfo, len(s.disks))
	for i, d := range s.disks {
		used := uint64(float64(d.TotalBytes) * s.diskPct / 100.0)
		disks[i] = &agentv1.DiskInfo{
			MountPoint:  d.MountPoint,
			Device:      d.Device,
			FsType:      d.FsType,
			TotalBytes:  d.TotalBytes,
			UsedBytes:   used,
			FreeBytes:   d.TotalBytes - used,
			PercentUsed: float32(s.diskPct),
		}
	}

	return &Snapshot{
		CPUPercent:    float32(s.cpuPct),
		MemoryPercent: float32(s.memPct),
		DiskPercent:   float32(s.diskPct),
		UptimeSeconds: s.uptimeSec,
		Disks:         disks,
		NetIfaces:     s.netIfaces,
		OSVersion:     s.osVersionStr,
	}
}

// Snapshot holds the values produced by a single Tick.
type Snapshot struct {
	CPUPercent    float32
	MemoryPercent float32
	DiskPercent   float32
	UptimeSeconds int64
	Disks         []*agentv1.DiskInfo
	NetIfaces     []*agentv1.NetworkInterface
	OSVersion     string
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
