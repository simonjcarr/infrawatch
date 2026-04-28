//go:build !windows

package tasks

import "testing"

func TestParseOSReleaseMetadata(t *testing.T) {
	t.Parallel()

	info := parseOSRelease([]byte(`NAME="Ubuntu"
ID=ubuntu
VERSION_ID="22.04"
VERSION_CODENAME=jammy
ID_LIKE="debian linux"
PRETTY_NAME="Ubuntu 22.04.4 LTS"
`))

	if info.ID != "ubuntu" {
		t.Fatalf("ID = %q, want ubuntu", info.ID)
	}
	if info.VersionID != "22.04" {
		t.Fatalf("VersionID = %q, want 22.04", info.VersionID)
	}
	if info.VersionCodename != "jammy" {
		t.Fatalf("VersionCodename = %q, want jammy", info.VersionCodename)
	}
	if len(info.IDLike) != 2 || info.IDLike[0] != "debian" || info.IDLike[1] != "linux" {
		t.Fatalf("IDLike = %#v, want [debian linux]", info.IDLike)
	}
}

func TestParseDpkgInventoryLineIncludesSourcePackage(t *testing.T) {
	t.Parallel()

	info := osReleaseInfo{ID: "ubuntu", VersionID: "22.04", VersionCodename: "jammy", IDLike: []string{"debian"}}
	pkg, ok := parseDpkgInventoryLine("libssl3\t3.0.2-0ubuntu1.15\tamd64\tUbuntu Developers\topenssl\t3.0.2-0ubuntu1.15\t1714089600", info)
	if !ok {
		t.Fatal("parseDpkgInventoryLine returned ok=false")
	}

	if pkg.Name != "libssl3" || pkg.Version != "3.0.2-0ubuntu1.15" || pkg.SourceName != "openssl" {
		t.Fatalf("unexpected package: %#v", pkg)
	}
	if pkg.DistroID != "ubuntu" || pkg.DistroVersionID != "22.04" || pkg.DistroCodename != "jammy" {
		t.Fatalf("missing distro metadata: %#v", pkg)
	}
}

func TestParseRpmSourcePackage(t *testing.T) {
	t.Parallel()

	name, version, release := parseSourceRPM("openssl-3.2.2-9.el9_5.src.rpm")
	if name != "openssl" || version != "3.2.2" || release != "9.el9_5" {
		t.Fatalf("parseSourceRPM = (%q, %q, %q), want openssl 3.2.2 9.el9_5", name, version, release)
	}
}
