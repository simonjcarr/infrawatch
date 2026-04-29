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
