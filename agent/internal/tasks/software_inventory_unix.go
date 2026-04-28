//go:build !windows

package tasks

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

type osReleaseInfo struct {
	ID              string
	VersionID       string
	VersionCodename string
	IDLike          []string
}

// collectPackages detects the host OS and runs the appropriate package
// enumeration. Called by RunSoftwareInventory (software_inventory.go).
func collectPackages(ctx context.Context) ([]collectedPackage, string, error) {
	switch runtime.GOOS {
	case "linux":
		return collectLinuxPackages(ctx)
	case "darwin":
		pkgs, err := collectMacOSPackages(ctx)
		return pkgs, "macapps", err
	default:
		return nil, "other", fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// collectLinuxPackages tries dpkg → rpm → pacman → apk in order.
func collectLinuxPackages(ctx context.Context) ([]collectedPackage, string, error) {
	osInfo := readOSReleaseInfo()
	type collector struct {
		source string
		fn     func(context.Context, osReleaseInfo) ([]collectedPackage, error)
	}
	for _, c := range []collector{
		{"dpkg", collectDpkg},
		{"rpm", collectRpm},
		{"pacman", collectPacman},
		{"apk", collectApk},
	} {
		pkgs, err := c.fn(ctx, osInfo)
		if err != nil {
			slog.Info("software_inventory: collector failed, trying next", "source", c.source, "err", err)
			continue
		}
		if len(pkgs) == 0 {
			slog.Warn("software_inventory: collector returned 0 packages, trying next", "source", c.source)
			continue
		}
		slog.Info("software_inventory: collector succeeded", "source", c.source, "packages", len(pkgs))
		return pkgs, c.source, nil
	}
	return nil, "other", fmt.Errorf("no supported package manager found (dpkg/rpm/pacman/apk)")
}

func readOSReleaseInfo() osReleaseInfo {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return osReleaseInfo{}
	}
	return parseOSRelease(data)
}

func parseOSRelease(data []byte) osReleaseInfo {
	values := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[key] = unquoteOSReleaseValue(strings.TrimSpace(value))
	}

	codename := values["VERSION_CODENAME"]
	if codename == "" {
		codename = values["UBUNTU_CODENAME"]
	}
	return osReleaseInfo{
		ID:              values["ID"],
		VersionID:       values["VERSION_ID"],
		VersionCodename: codename,
		IDLike:          strings.Fields(values["ID_LIKE"]),
	}
}

func unquoteOSReleaseValue(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		quote := value[0]
		if (quote == '"' || quote == '\'') && value[len(value)-1] == quote {
			unquoted, err := strconv.Unquote(value)
			if err == nil {
				return unquoted
			}
			return value[1 : len(value)-1]
		}
	}
	return value
}

func applyDistroInfo(p *collectedPackage, info osReleaseInfo) {
	p.DistroID = info.ID
	p.DistroVersionID = info.VersionID
	p.DistroCodename = info.VersionCodename
	p.DistroIDLike = append([]string(nil), info.IDLike...)
}

// collectDpkg collects packages via dpkg-query.
func collectDpkg(ctx context.Context, info osReleaseInfo) ([]collectedPackage, error) {
	if _, err := exec.LookPath("dpkg-query"); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "dpkg-query", "-W",
		"-f=${Package}\t${Version}\t${Architecture}\t${Maintainer}\t${source:Package}\t${source:Version}\t${db-fsys:Last-Modified}\n")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var pkgs []collectedPackage
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		if p, ok := parseDpkgInventoryLine(scanner.Text(), info); ok {
			pkgs = append(pkgs, p)
		}
	}
	return pkgs, nil
}

func parseDpkgInventoryLine(line string, info osReleaseInfo) (collectedPackage, bool) {
	fields := strings.SplitN(line, "\t", 7)
	if len(fields) < 2 || strings.TrimSpace(fields[0]) == "" {
		return collectedPackage{}, false
	}
	p := collectedPackage{
		Name:          strings.TrimSpace(fields[0]),
		Version:       strings.TrimSpace(fields[1]),
		Arch:          trimField(fields, 2),
		Publisher:     trimField(fields, 3),
		SourceName:    trimField(fields, 4),
		SourceVersion: trimField(fields, 5),
	}
	if p.SourceName == "" {
		p.SourceName = p.Name
	}
	if p.SourceVersion == "" {
		p.SourceVersion = p.Version
	}
	if ts := trimField(fields, 6); ts != "" {
		if unix, err := strconv.ParseInt(ts, 10, 64); err == nil {
			p.InstallDate = unix
		}
	}
	applyDistroInfo(&p, info)
	return p, p.Name != "" && p.Version != ""
}

// collectRpm collects packages via rpm.
func collectRpm(ctx context.Context, info osReleaseInfo) ([]collectedPackage, error) {
	if _, err := exec.LookPath("rpm"); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "rpm", "-qa",
		"--qf", "%{NAME}\t%{EPOCHNUM}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\t%{VENDOR}\t%{SOURCERPM}\t%{INSTALLTIME}\n")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var pkgs []collectedPackage
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		fields := strings.SplitN(scanner.Text(), "\t", 8)
		if len(fields) < 4 {
			continue
		}
		epoch := trimField(fields, 1)
		version := trimField(fields, 2)
		release := trimField(fields, 3)
		fullVersion := version
		if release != "" {
			fullVersion += "-" + release
		}
		if epoch != "" && epoch != "0" && epoch != "(none)" {
			fullVersion = epoch + ":" + fullVersion
		}
		sourceName, sourceVersion, sourceRelease := parseSourceRPM(trimField(fields, 6))
		p := collectedPackage{
			Name:           strings.TrimSpace(fields[0]),
			Version:        fullVersion,
			Arch:           trimField(fields, 4),
			Publisher:      trimField(fields, 5),
			SourceName:     sourceName,
			SourceVersion:  sourceVersion,
			PackageEpoch:   epoch,
			PackageRelease: release,
		}
		if p.SourceName == "" {
			p.SourceName = p.Name
		}
		if p.SourceVersion == "" {
			p.SourceVersion = version
			if sourceRelease != "" {
				p.SourceVersion += "-" + sourceRelease
			}
		}
		if ts := trimField(fields, 7); ts != "" {
			if unix, err := strconv.ParseInt(ts, 10, 64); err == nil {
				p.InstallDate = unix
			}
		}
		applyDistroInfo(&p, info)
		if p.Name != "" && p.Version != "" {
			pkgs = append(pkgs, p)
		}
	}
	return pkgs, nil
}

func parseSourceRPM(source string) (name, version, release string) {
	source = strings.TrimSpace(source)
	source = strings.TrimSuffix(source, ".src.rpm")
	if source == "" || source == "(none)" {
		return "", "", ""
	}
	lastDash := strings.LastIndex(source, "-")
	if lastDash <= 0 || lastDash == len(source)-1 {
		return source, "", ""
	}
	release = source[lastDash+1:]
	withoutRelease := source[:lastDash]
	versionDash := strings.LastIndex(withoutRelease, "-")
	if versionDash <= 0 || versionDash == len(withoutRelease)-1 {
		return withoutRelease, "", release
	}
	return withoutRelease[:versionDash], withoutRelease[versionDash+1:], release
}

// collectPacman collects packages via pacman.
func collectPacman(ctx context.Context, info osReleaseInfo) ([]collectedPackage, error) {
	if _, err := exec.LookPath("pacman"); err != nil {
		return nil, err
	}
	out, err := exec.CommandContext(ctx, "pacman", "-Q").Output()
	if err != nil {
		return nil, err
	}
	var pkgs []collectedPackage
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) >= 2 {
			p := collectedPackage{Name: parts[0], Version: parts[1], SourceName: parts[0], SourceVersion: parts[1]}
			applyDistroInfo(&p, info)
			pkgs = append(pkgs, p)
		}
	}
	return pkgs, nil
}

// collectApk collects packages via apk (Alpine Linux).
func collectApk(ctx context.Context, info osReleaseInfo) ([]collectedPackage, error) {
	if _, err := exec.LookPath("apk"); err != nil {
		return nil, err
	}
	out, err := exec.CommandContext(ctx, "apk", "info", "-v").Output()
	if err != nil {
		return nil, err
	}
	var pkgs []collectedPackage
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		name, version := splitApkNameVersion(line)
		if name != "" && version != "" {
			p := collectedPackage{Name: name, Version: version, SourceName: name, SourceVersion: version}
			applyDistroInfo(&p, info)
			pkgs = append(pkgs, p)
		}
	}
	return pkgs, nil
}

// splitApkNameVersion splits "musl-1.2.4-r4" → ("musl", "1.2.4-r4").
// apk package names can contain hyphens (e.g. "ca-certificates"), so we walk
// backwards to find the last hyphen that precedes a digit-starting segment.
func splitApkNameVersion(s string) (name, version string) {
	for i := len(s) - 1; i > 0; i-- {
		if s[i] == '-' && i+1 < len(s) && s[i+1] >= '0' && s[i+1] <= '9' {
			return s[:i], s[i+1:]
		}
	}
	return s, ""
}

// collectMacOSPackages collects .app applications via system_profiler and
// optionally Homebrew packages.
func collectMacOSPackages(ctx context.Context) ([]collectedPackage, error) {
	type spApp struct {
		Name    string `json:"_name"`
		Version string `json:"version"`
	}
	type spData struct {
		SPApplicationsDataType []spApp `json:"SPApplicationsDataType"`
	}

	var apps []collectedPackage

	if out, err := exec.CommandContext(ctx, "system_profiler", "SPApplicationsDataType", "-json").Output(); err == nil {
		var data spData
		if jsonErr := json.Unmarshal(out, &data); jsonErr == nil {
			for _, a := range data.SPApplicationsDataType {
				if a.Name != "" {
					apps = append(apps, collectedPackage{Name: a.Name, Version: a.Version})
				}
			}
		}
	}

	if _, err := exec.LookPath("brew"); err == nil {
		if out, err := exec.CommandContext(ctx, "brew", "list", "--versions").Output(); err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(out)))
			for scanner.Scan() {
				parts := strings.Fields(scanner.Text())
				if len(parts) >= 2 {
					apps = append(apps, collectedPackage{Name: parts[0], Version: parts[1]})
				}
			}
		}
	}

	return apps, nil
}

// trimField safely returns the trimmed element at index i, or "" if out of range.
func trimField(fields []string, i int) string {
	if i < len(fields) {
		return strings.TrimSpace(fields[i])
	}
	return ""
}
