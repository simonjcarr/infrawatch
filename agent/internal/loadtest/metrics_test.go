package loadtest

import (
	"testing"
)

func TestSyntheticMetricsTickStaysInBounds(t *testing.T) {
	m := NewSyntheticMetrics(42, "loadtest-abc-0042", 1.0)

	for i := 0; i < 10_000; i++ {
		snap := m.Tick()
		if snap.CPUPercent < 1 || snap.CPUPercent > 99 {
			t.Fatalf("cpu out of bounds after %d ticks: %f", i, snap.CPUPercent)
		}
		if snap.MemoryPercent < 5 || snap.MemoryPercent > 95 {
			t.Fatalf("memory out of bounds after %d ticks: %f", i, snap.MemoryPercent)
		}
		if snap.DiskPercent < 10 || snap.DiskPercent > 98 {
			t.Fatalf("disk out of bounds after %d ticks: %f", i, snap.DiskPercent)
		}
	}
}

func TestSyntheticMetricsSeededByIndex(t *testing.T) {
	a := NewSyntheticMetrics(1, "host-1", 0.1)
	b := NewSyntheticMetrics(2, "host-2", 0.1)

	// The first-tick values are seeded from (agentIndex, hostname) so two
	// different indexes should produce different baselines — otherwise all N
	// agents would look identical on dashboards.
	sa := a.Tick()
	sb := b.Tick()
	if sa.CPUPercent == sb.CPUPercent && sa.MemoryPercent == sb.MemoryPercent {
		t.Fatalf("expected different baselines across agent indexes, got identical snapshots")
	}
}

func TestSyntheticMetricsTickDiskUsagePopulated(t *testing.T) {
	m := NewSyntheticMetrics(7, "host-7", 0.1)
	snap := m.Tick()

	if len(snap.Disks) == 0 {
		t.Fatal("expected at least one disk in snapshot")
	}
	for _, d := range snap.Disks {
		if d.UsedBytes+d.FreeBytes != d.TotalBytes {
			t.Fatalf("disk %s: used+free != total (%d + %d != %d)", d.MountPoint, d.UsedBytes, d.FreeBytes, d.TotalBytes)
		}
		if d.PercentUsed <= 0 {
			t.Fatalf("disk %s percent_used should be > 0, got %f", d.MountPoint, d.PercentUsed)
		}
	}
}

func TestClampBounds(t *testing.T) {
	cases := []struct{ v, lo, hi, want float64 }{
		{5, 0, 10, 5},
		{-1, 0, 10, 0},
		{11, 0, 10, 10},
		{0, 0, 10, 0},
		{10, 0, 10, 10},
	}
	for _, c := range cases {
		got := clamp(c.v, c.lo, c.hi)
		if got != c.want {
			t.Errorf("clamp(%v, %v, %v) = %v, want %v", c.v, c.lo, c.hi, got, c.want)
		}
	}
}
