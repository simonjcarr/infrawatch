package loadtest

import "testing"

// TestConnPoolSlotMath verifies the index -> slot mapping never produces a
// negative slot — a regression check for a bug where preflight's sentinel
// index of -1 caused an out-of-range panic at pool sizes > 1, because Go's
// `%` operator returns a negatively-signed result for negative dividends.
func TestConnPoolSlotMath(t *testing.T) {
	cases := []struct {
		size       int
		index      int
		wantInRange bool
	}{
		{1, -1, true},
		{8, -1, true},
		{8, 0, true},
		{8, 399, true},
		{50, -1, true},
		{50, 9999, true},
	}

	for _, c := range cases {
		p := NewConnPool("localhost:0", "", true, c.size)
		slot := c.index % p.size
		if slot < 0 {
			slot += p.size
		}
		if slot < 0 || slot >= p.size {
			t.Errorf("size=%d index=%d: slot=%d out of [0,%d)", c.size, c.index, slot, p.size)
		}
	}
}
