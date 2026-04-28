package checks

import (
	"testing"
	"time"
)

func TestParseAptUpgradable(t *testing.T) {
	t.Parallel()

	output := `Listing...
openssl/jammy-updates 3.0.2-0ubuntu1.16 amd64 [upgradable from: 3.0.2-0ubuntu1.15]
libssl3/jammy-updates 3.0.2-0ubuntu1.16 amd64 [upgradable from: 3.0.2-0ubuntu1.15]
`

	updates := parseAptUpgradable(output, 10)
	if len(updates) != 2 {
		t.Fatalf("len(updates) = %d, want 2", len(updates))
	}
	if updates[0].Name != "openssl" || updates[0].CurrentVersion != "3.0.2-0ubuntu1.15" || updates[0].AvailableVersion != "3.0.2-0ubuntu1.16" {
		t.Fatalf("unexpected first update: %#v", updates[0])
	}
}

func TestParseRpmCheckUpdateTreatsPackageRowsOnly(t *testing.T) {
	t.Parallel()

	output := `Last metadata expiration check: 0:13:22 ago on Tue 28 Apr 2026 09:00:00 BST.
openssl.x86_64                 1:3.2.2-9.el9_5                 baseos
kernel-core.x86_64             5.14.0-503.38.1.el9_5           baseos
`

	updates := parseRpmCheckUpdate(output, 10)
	if len(updates) != 2 {
		t.Fatalf("len(updates) = %d, want 2", len(updates))
	}
	if updates[0].Name != "openssl" || updates[0].Architecture != "x86_64" || updates[0].AvailableVersion != "1:3.2.2-9.el9_5" {
		t.Fatalf("unexpected first update: %#v", updates[0])
	}
}

func TestParseWindowsHotfixJSON(t *testing.T) {
	t.Parallel()

	got, err := parseWindowsHotfixJSON([]byte(`{"HotFixID":"KB5036892","InstalledOn":"2026-04-20T00:00:00Z"}`))
	if err != nil {
		t.Fatalf("parseWindowsHotfixJSON: %v", err)
	}
	want := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("installed date = %s, want %s", got, want)
	}
}

func TestEvaluatePatchStatusUsesPatchAgeOnly(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC)
	report := buildPatchStatusReport(patchStatusInput{
		Now:              now,
		MaxAgeDays:       30,
		LastPatchedAt:    now.AddDate(0, 0, -12),
		PackageManager:   "apt",
		UpdatesSupported: true,
		Updates:          []patchStatusUpdate{{Name: "openssl", AvailableVersion: "3.0.2"}},
	})

	if report.PatchAgeDays != 12 {
		t.Fatalf("PatchAgeDays = %d, want 12", report.PatchAgeDays)
	}
	if report.Status != "pass" {
		t.Fatalf("Status = %q, want pass despite available updates", report.Status)
	}
	if report.UpdatesCount != 1 {
		t.Fatalf("UpdatesCount = %d, want 1", report.UpdatesCount)
	}
}
