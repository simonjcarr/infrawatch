package vuln

import (
	"strings"
	"testing"
)

func TestParseCISAKEV(t *testing.T) {
	t.Parallel()

	doc := `{"vulnerabilities":[{"cveID":"CVE-2024-1234","vendorProject":"OpenSSL","product":"OpenSSL","knownRansomwareCampaignUse":"Known","dueDate":"2024-06-01","requiredAction":"Apply updates"}]}`
	kev, err := ParseCISAKEV(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("ParseCISAKEV: %v", err)
	}
	if len(kev) != 1 || kev[0].CVEID != "CVE-2024-1234" || !kev[0].KnownRansomwareCampaignUse {
		t.Fatalf("unexpected KEV entries: %#v", kev)
	}
}

func TestParseDebianTracker(t *testing.T) {
	t.Parallel()

	doc := `{
	  "openssl": {
	    "CVE-2024-1234": {
	      "description": "test vuln",
	      "releases": {
	        "bookworm": {"status": "open", "fixed_version": "3.0.11-1~deb12u2", "urgency": "high"},
	        "bullseye": {"status": "resolved", "fixed_version": "1.1.1w-0+deb11u1", "urgency": "medium"}
	      }
	    }
	  }
	}`
	records, affected, err := ParseDebianTracker(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("ParseDebianTracker: %v", err)
	}
	if len(records) != 1 || records[0].CVEID != "CVE-2024-1234" {
		t.Fatalf("unexpected CVEs: %#v", records)
	}
	if len(affected) != 2 {
		t.Fatalf("len(affected) = %d, want 2", len(affected))
	}
	if affected[0].PackageName != "openssl" || affected[0].DistroCodename != "bookworm" || affected[0].FixedVersion != "3.0.11-1~deb12u2" {
		t.Fatalf("unexpected affected row: %#v", affected[0])
	}
}

func TestParseAlpineSecDB(t *testing.T) {
	t.Parallel()

	doc := `{"packages":[{"pkg":{"name":"openssl"},"secfixes":{"3.1.4-r1":["CVE-2024-1234","CVE-2024-9999"]}}]}`
	records, affected, err := ParseAlpineSecDB(strings.NewReader(doc), "v3.19", "main")
	if err != nil {
		t.Fatalf("ParseAlpineSecDB: %v", err)
	}
	if len(records) != 2 || len(affected) != 2 {
		t.Fatalf("records=%d affected=%d, want 2 and 2", len(records), len(affected))
	}
	if affected[0].DistroVersionID != "3.19" || affected[0].Repository != "main" || affected[0].FixedVersion != "3.1.4-r1" {
		t.Fatalf("unexpected affected row: %#v", affected[0])
	}
}

func TestParseRedHatStructuredAffectedRelease(t *testing.T) {
	t.Parallel()

	doc := `[{
	  "CVE": "CVE-2025-0001",
	  "bugzilla_description": "openssl backport fix",
	  "severity": "important",
	  "affected_release": [{
	    "product_name": "Red Hat Enterprise Linux 8",
	    "package": "openssl-1:1.1.1k-12.el8_9.6.x86_64",
	    "advisory": "RHSA-2025:0001"
	  }]
	}]`
	records, affected, err := parseRedHatCVEList(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("parseRedHatCVEList: %v", err)
	}
	if len(records) != 1 || records[0].CVEID != "CVE-2025-0001" || records[0].Severity != SeverityHigh {
		t.Fatalf("unexpected CVE records: %#v", records)
	}
	if len(affected) != 1 {
		t.Fatalf("len(affected) = %d, want 1: %#v", len(affected), affected)
	}
	row := affected[0]
	if row.PackageName != "openssl" {
		t.Fatalf("PackageName = %q, want openssl", row.PackageName)
	}
	if row.FixedVersion != "1:1.1.1k-12.el8_9.6" {
		t.Fatalf("FixedVersion = %q, want full RPM EVR", row.FixedVersion)
	}
	if row.DistroID != "rhel" || row.DistroVersionID != "8" {
		t.Fatalf("distro = %q %q, want rhel 8", row.DistroID, row.DistroVersionID)
	}
	if row.PackageState != "fixed" {
		t.Fatalf("PackageState = %q, want fixed", row.PackageState)
	}
	if !strings.Contains(string(row.MetadataJSON), "RHSA-2025:0001") {
		t.Fatalf("metadata did not include advisory: %s", string(row.MetadataJSON))
	}
}

func TestParseRedHatFreeTextAffectedPackageIsProbable(t *testing.T) {
	t.Parallel()

	doc := `[{
	  "CVE": "CVE-2025-0002",
	  "severity": "moderate",
	  "affected_packages": ["openssl fixed in openssl-1:1.1.1k-12.el8_9.6.x86_64"]
	}]`
	_, affected, err := parseRedHatCVEList(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("parseRedHatCVEList: %v", err)
	}
	if len(affected) != 1 {
		t.Fatalf("len(affected) = %d, want 1: %#v", len(affected), affected)
	}
	if affected[0].PackageState != "probable" {
		t.Fatalf("PackageState = %q, want probable", affected[0].PackageState)
	}
	if affected[0].PackageName != "openssl" || affected[0].FixedVersion != "1:1.1.1k-12.el8_9.6" {
		t.Fatalf("unexpected affected row: %#v", affected[0])
	}
}

func TestParseRedHatCSAFListReleasedPackages(t *testing.T) {
	t.Parallel()

	doc := `[{
	  "RHSA": "RHSA-2026:1473",
	  "severity": "important",
	  "released_on": "2026-01-28T10:08:56Z",
	  "CVEs": ["CVE-2025-66199", "CVE-2025-15467"],
	  "released_packages": [
	    "openssl-1:3.5.1-7.el9_7.x86_64",
	    "openssl-libs-1:3.5.1-7.el9_7.x86_64",
	    "openssl-1:3.5.1-7.el9_7.src",
	    "openssl-main@x86_64"
	  ],
	  "resource_url": "https://access.redhat.com/hydra/rest/securitydata/csaf/RHSA-2026:1473.json"
	}]`

	records, affected, err := ParseRedHatCSAFList(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("ParseRedHatCSAFList: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("len(records) = %d, want 2: %#v", len(records), records)
	}
	if len(affected) != 6 {
		t.Fatalf("len(affected) = %d, want 6: %#v", len(affected), affected)
	}
	var row AffectedPackage
	for _, candidate := range affected {
		if candidate.CVEID == "CVE-2025-15467" && candidate.PackageName == "openssl-libs" {
			row = candidate
			break
		}
	}
	if row.CVEID != "CVE-2025-15467" || row.PackageName != "openssl-libs" {
		t.Fatalf("unexpected affected row identity: %#v", row)
	}
	if row.DistroID != "rhel" || row.DistroVersionID != "9" {
		t.Fatalf("distro = %q %q, want rhel 9", row.DistroID, row.DistroVersionID)
	}
	if row.FixedVersion != "1:3.5.1-7.el9_7" {
		t.Fatalf("FixedVersion = %q, want full RPM EVR", row.FixedVersion)
	}
	if row.PackageState != "fixed" || row.Severity != SeverityHigh {
		t.Fatalf("state/severity = %q/%q, want fixed/high", row.PackageState, row.Severity)
	}
	if !strings.Contains(string(row.MetadataJSON), "RHSA-2026:1473") {
		t.Fatalf("metadata did not include advisory: %s", string(row.MetadataJSON))
	}
}
