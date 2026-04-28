package vuln

import "testing"

func TestCompareDebianVersions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		a, b string
		want int
	}{
		{"1.1.1f-1ubuntu2.18", "1.1.1f-1ubuntu2.19", -1},
		{"2:1.0-1", "1:9.9-9", 1},
		{"1.0~rc1-1", "1.0-1", -1},
		{"1.0-1ubuntu1", "1.0-1ubuntu1", 0},
	}
	for _, tt := range tests {
		if got := CompareDistroVersion("dpkg", tt.a, tt.b); got != tt.want {
			t.Fatalf("CompareDistroVersion(dpkg, %q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestCompareRPMVersions(t *testing.T) {
	t.Parallel()

	if got := CompareDistroVersion("rpm", "1:3.2.2-8.el9", "1:3.2.2-9.el9"); got != -1 {
		t.Fatalf("rpm compare = %d, want -1", got)
	}
	if got := CompareDistroVersion("rpm", "2:1.0-1", "1:9.9-9"); got != 1 {
		t.Fatalf("rpm epoch compare = %d, want 1", got)
	}
}

func TestCompareAlpineVersions(t *testing.T) {
	t.Parallel()

	if got := CompareDistroVersion("apk", "1.2.4-r3", "1.2.4-r4"); got != -1 {
		t.Fatalf("apk compare = %d, want -1", got)
	}
}
