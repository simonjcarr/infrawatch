package vuln

import "strings"

func MatchPackage(pkg InventoryPackage, affected AffectedPackage) (bool, string) {
	if !supportedInventorySource(pkg.Source) {
		return false, "unsupported inventory source"
	}
	if affected.DistroID != "" && !strings.EqualFold(pkg.DistroID, affected.DistroID) {
		return false, "distro mismatch"
	}
	if affected.DistroVersionID != "" && pkg.DistroVersionID != "" && affected.DistroVersionID != pkg.DistroVersionID {
		return false, "distro version mismatch"
	}
	if affected.DistroCodename != "" && pkg.DistroCodename != "" && affected.DistroCodename != pkg.DistroCodename {
		return false, "distro codename mismatch"
	}

	if !packageNameMatches(pkg, affected) {
		return false, "package mismatch"
	}

	installed := sourceVersionForMatch(pkg, affected)
	if installed == "" {
		return false, "missing installed version"
	}
	for _, version := range affected.AffectedVersions {
		if version == installed {
			return true, "listed affected version"
		}
	}
	if affected.FixedVersion == "" {
		return false, "no fixed version"
	}
	if CompareDistroVersion(pkg.Source, installed, affected.FixedVersion) < 0 {
		return true, "installed version is below fixed version"
	}
	return false, "installed version is fixed"
}

func supportedInventorySource(source string) bool {
	switch source {
	case "dpkg", "rpm", "apk":
		return true
	default:
		return false
	}
}

func packageNameMatches(pkg InventoryPackage, affected AffectedPackage) bool {
	if affected.PackageName == "" {
		return false
	}
	if pkg.SourceName != "" && pkg.SourceName == affected.PackageName {
		return true
	}
	if pkg.Name == affected.PackageName {
		return true
	}
	if affected.SourcePackageName != "" && pkg.SourceName == affected.SourcePackageName {
		return true
	}
	return false
}
