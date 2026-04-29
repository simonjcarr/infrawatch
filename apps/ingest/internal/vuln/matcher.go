package vuln

import "strings"

func MatchPackage(pkg InventoryPackage, affected AffectedPackage) (bool, string) {
	if !supportedInventorySource(pkg.Source) {
		return false, "unsupported inventory source"
	}
	if affected.DistroID != "" && !distroMatches(pkg, affected) {
		return false, "distro mismatch"
	}
	if affected.DistroVersionID != "" && pkg.DistroVersionID != "" && !distroVersionMatches(pkg, affected) {
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
		if pkg.Source == "rpm" {
			return true, "installed rpm evr is below vendor fixed evr"
		}
		return true, "installed version is below fixed version"
	}
	return false, "installed version is fixed"
}

func distroMatches(pkg InventoryPackage, affected AffectedPackage) bool {
	if strings.EqualFold(pkg.DistroID, affected.DistroID) {
		return true
	}
	if pkg.Source == "rpm" && strings.EqualFold(affected.DistroID, "rhel") {
		return isRHELCompatibleDistro(pkg)
	}
	return false
}

func distroVersionMatches(pkg InventoryPackage, affected AffectedPackage) bool {
	if affected.DistroVersionID == pkg.DistroVersionID {
		return true
	}
	if pkg.Source == "rpm" && strings.EqualFold(affected.DistroID, "rhel") && isRHELCompatibleDistro(pkg) {
		return !strings.Contains(affected.DistroVersionID, ".") && strings.HasPrefix(pkg.DistroVersionID, affected.DistroVersionID+".")
	}
	return false
}

func isRHELCompatibleDistro(pkg InventoryPackage) bool {
	switch strings.ToLower(pkg.DistroID) {
	case "rhel", "redhat", "redhatenterpriseserver", "almalinux", "rocky", "centos", "ol", "oraclelinux", "miraclelinux":
		return true
	}
	for _, like := range pkg.DistroIDLike {
		if strings.EqualFold(like, "rhel") {
			return true
		}
	}
	return false
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
