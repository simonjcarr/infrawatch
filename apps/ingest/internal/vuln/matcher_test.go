package vuln

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPackageMatchesAffectedRange(t *testing.T) {
	t.Parallel()

	pkg := InventoryPackage{
		ID:              "pkg1",
		HostID:          "host1",
		OrganisationID:  "org1",
		Name:            "libssl3",
		Version:         "3.0.2-0ubuntu1.15",
		Source:          "dpkg",
		DistroID:        "ubuntu",
		DistroVersionID: "22.04",
		DistroCodename:  "jammy",
		SourceName:      "openssl",
	}
	affected := AffectedPackage{
		CVEID:           "CVE-2024-1234",
		Source:          "ubuntu-osv",
		PackageName:     "openssl",
		DistroID:        "ubuntu",
		DistroVersionID: "22.04",
		DistroCodename:  "jammy",
		FixedVersion:    "3.0.2-0ubuntu1.16",
	}

	match, reason := MatchPackage(pkg, affected)
	if !match {
		t.Fatalf("MatchPackage returned false: %s", reason)
	}
}

func TestPackageDoesNotMatchDifferentDistro(t *testing.T) {
	t.Parallel()

	pkg := InventoryPackage{Source: "dpkg", DistroID: "debian", DistroCodename: "bookworm", SourceName: "openssl", Version: "3.0.11-1"}
	affected := AffectedPackage{PackageName: "openssl", DistroID: "ubuntu", DistroCodename: "jammy", FixedVersion: "3.0.2-0ubuntu1.16"}

	match, _ := MatchPackage(pkg, affected)
	if match {
		t.Fatal("expected distro mismatch not to match")
	}
}

func TestPackageWithUnsupportedSourceIsUnassessed(t *testing.T) {
	t.Parallel()

	pkg := InventoryPackage{Source: "homebrew", DistroID: "darwin", Name: "openssl", Version: "3.2.0"}
	affected := AffectedPackage{PackageName: "openssl", DistroID: "ubuntu", FixedVersion: "3.0.2-0ubuntu1.16"}

	match, reason := MatchPackage(pkg, affected)
	if match || reason != "unsupported inventory source" {
		t.Fatalf("MatchPackage = %v, %q; want false unsupported inventory source", match, reason)
	}
}

func TestRPMBackportReleaseMatch(t *testing.T) {
	t.Parallel()

	pkg := InventoryPackage{
		ID:              "pkg1",
		OrganisationID:  "org1",
		HostID:          "host1",
		Name:            "openssl-libs",
		Version:         "1:1.1.1k-12.el8_9.4",
		Source:          "rpm",
		DistroID:        "rhel",
		DistroVersionID: "8.9",
		SourceName:      "openssl",
		SourceVersion:   "1:1.1.1k-12.el8_9.4",
	}
	affected := AffectedPackage{
		CVEID:           "CVE-2025-0001",
		Source:          "redhat-security-data",
		DistroID:        "rhel",
		DistroVersionID: "8",
		PackageName:     "openssl",
		FixedVersion:    "1:1.1.1k-12.el8_9.6",
	}

	match, reason := MatchPackage(pkg, affected)
	if !match {
		t.Fatalf("MatchPackage returned false: %s", reason)
	}
	if reason != "installed rpm evr is below vendor fixed evr" {
		t.Fatalf("reason = %q, want RPM EVR-specific reason", reason)
	}
}

func TestRPMBackportReleaseDoesNotMatchFixedPackage(t *testing.T) {
	t.Parallel()

	pkg := InventoryPackage{
		Name:            "openssl-libs",
		Version:         "1:1.1.1k-12.el8_9.6",
		Source:          "rpm",
		DistroID:        "rhel",
		DistroVersionID: "8",
		SourceName:      "openssl",
		SourceVersion:   "1:1.1.1k-12.el8_9.6",
	}
	affected := AffectedPackage{
		Source:          "redhat-security-data",
		DistroID:        "rhel",
		DistroVersionID: "8",
		PackageName:     "openssl",
		FixedVersion:    "1:1.1.1k-12.el8_9.6",
	}

	match, reason := MatchPackage(pkg, affected)
	if match {
		t.Fatalf("expected fixed RPM package not to match, reason=%q", reason)
	}
	if reason != "installed version is fixed" {
		t.Fatalf("reason = %q, want fixed package reason", reason)
	}
}

func TestRPMRHELCompatibleDistroMatchesRedHatAdvisory(t *testing.T) {
	t.Parallel()

	pkg := InventoryPackage{
		Name:            "openssl-libs",
		Version:         "1:3.5.1-5.el9_7",
		Source:          "rpm",
		DistroID:        "almalinux",
		DistroIDLike:    []string{"rhel", "centos", "fedora"},
		DistroVersionID: "9.7",
		SourceName:      "openssl",
		SourceVersion:   "1:3.5.1-5.el9_7",
	}
	affected := AffectedPackage{
		Source:          "redhat-security-data",
		DistroID:        "rhel",
		DistroVersionID: "9",
		PackageName:     "openssl",
		FixedVersion:    "1:3.5.1-7.el9_7",
	}

	match, reason := MatchPackage(pkg, affected)
	if !match {
		t.Fatalf("MatchPackage returned false: %s", reason)
	}
	if reason != "installed rpm evr is below vendor fixed evr" {
		t.Fatalf("reason = %q, want RPM EVR-specific reason", reason)
	}
}

func TestRPMNonRHELCompatibleDistroDoesNotMatchRedHatAdvisory(t *testing.T) {
	t.Parallel()

	pkg := InventoryPackage{
		Name:            "openssl-libs",
		Version:         "1:3.5.1-5.el9_7",
		Source:          "rpm",
		DistroID:        "suse",
		DistroIDLike:    []string{"suse"},
		DistroVersionID: "9.7",
		SourceName:      "openssl",
		SourceVersion:   "1:3.5.1-5.el9_7",
	}
	affected := AffectedPackage{
		Source:          "redhat-security-data",
		DistroID:        "rhel",
		DistroVersionID: "9",
		PackageName:     "openssl",
		FixedVersion:    "1:3.5.1-7.el9_7",
	}

	match, reason := MatchPackage(pkg, affected)
	if match || reason != "distro mismatch" {
		t.Fatalf("MatchPackage = %v, %q; want distro mismatch", match, reason)
	}
}

func TestUpsertFindingStoresConfirmedConfidenceAndReason(t *testing.T) {
	t.Parallel()

	tx := &recordingFindingTx{}
	pkg := InventoryPackage{
		ID:             "pkg1",
		OrganisationID: "org1",
		HostID:         "host1",
		Name:           "openssl-libs",
		Version:        "1:1.1.1k-12.el8_9.4",
		Source:         "rpm",
	}
	affected := AffectedPackage{
		ID:           "affected1",
		CVEID:        "CVE-2025-0001",
		FixedVersion: "1:1.1.1k-12.el8_9.6",
		Severity:     SeverityHigh,
	}

	if err := upsertFinding(context.Background(), tx, pkg, affected, "installed rpm evr is below vendor fixed evr"); err != nil {
		t.Fatalf("upsertFinding: %v", err)
	}
	if !strings.Contains(tx.query, "confidence") {
		t.Fatalf("upsert query did not write confidence column:\n%s", tx.query)
	}
	if !strings.Contains(tx.query, "match_reason") {
		t.Fatalf("upsert query did not write match_reason column:\n%s", tx.query)
	}
	if !containsArg(tx.args, string(FindingConfidenceConfirmed)) {
		t.Fatalf("upsert args did not include confirmed confidence: %#v", tx.args)
	}
	if !containsArg(tx.args, "installed rpm evr is below vendor fixed evr") {
		t.Fatalf("upsert args did not include match reason: %#v", tx.args)
	}
}

type recordingFindingTx struct {
	query string
	args  []any
}

func (tx *recordingFindingTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.query = query
	tx.args = append([]any(nil), args...)
	return pgconn.CommandTag{}, nil
}

func containsArg(args []any, want string) bool {
	for _, arg := range args {
		if s, ok := arg.(string); ok && s == want {
			return true
		}
	}
	return false
}
