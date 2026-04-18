package loadtest

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestComputePercentilesMonotonic(t *testing.T) {
	samples := make([]int64, 0, 1000)
	for i := int64(1); i <= 1000; i++ {
		samples = append(samples, i)
	}
	p := computePercentiles(samples)
	if p.count != 1000 {
		t.Fatalf("count: got %d, want 1000", p.count)
	}
	if !(p.p50 <= p.p90 && p.p90 <= p.p95 && p.p95 <= p.p99 && p.p99 <= p.p999) {
		t.Fatalf("percentiles not monotonic: %+v", p)
	}
	// On a uniform 1..1000 distribution p50 is ~500, p99 is ~990. Allow ±5.
	if p.p50 < 495 || p.p50 > 505 {
		t.Errorf("p50 out of expected range: %d", p.p50)
	}
	if p.p99 < 985 || p.p99 > 995 {
		t.Errorf("p99 out of expected range: %d", p.p99)
	}
}

func TestComputePercentilesEmpty(t *testing.T) {
	p := computePercentiles(nil)
	if p.count != 0 || p.p50 != 0 || p.p999 != 0 {
		t.Fatalf("empty input should produce zero snapshot, got %+v", p)
	}
}

func TestStatsSnapshotResetsSamples(t *testing.T) {
	s := NewStats()
	for i := 0; i < 100; i++ {
		s.RecordSendLatency(time.Duration(i+1) * time.Microsecond)
	}
	snap1, _ := s.snapshotLatencies()
	if snap1.count != 100 {
		t.Fatalf("first snapshot count: got %d, want 100", snap1.count)
	}

	// The second snapshot taken immediately should observe zero samples — the
	// stats printer relies on this reset to report *interval* latencies, not
	// cumulative ones.
	snap2, _ := s.snapshotLatencies()
	if snap2.count != 0 {
		t.Fatalf("second snapshot count: got %d, want 0 (samples should reset)", snap2.count)
	}
}

func TestStatsRecordErrorCaps(t *testing.T) {
	s := NewStats()
	for i := 0; i < 50; i++ {
		s.RecordError("connection reset")
	}
	s.RecordError("permission denied")
	top := s.topErrors(10)
	if top["connection reset"] != 50 {
		t.Fatalf("expected 50 hits for 'connection reset', got %d", top["connection reset"])
	}
	if top["permission denied"] != 1 {
		t.Fatalf("expected 1 hit for 'permission denied', got %d", top["permission denied"])
	}
}

func TestStatsFinaliseIncludesCoreLines(t *testing.T) {
	s := NewStats()
	s.RegistrationsActive.Add(42)
	s.HeartbeatsSent.Add(1000)
	s.BytesSent.Add(2 * 1024 * 1024)

	buf := &bytes.Buffer{}
	s.Finalise(buf, "lt-261117-demo", 42, "")
	out := buf.String()

	for _, want := range []string{
		"Load test summary",
		"run_id:",
		"lt-261117-demo",
		"heartbeats:",
		"sent=1000",
		"bytes_sent:",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("summary missing %q:\n%s", want, out)
		}
	}
}
