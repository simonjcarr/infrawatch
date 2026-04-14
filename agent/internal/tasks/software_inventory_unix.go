//go:build !windows

package tasks

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

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
	type collector struct {
		source string
		fn     func(context.Context) ([]collectedPackage, error)
	}
	for _, c := range []collector{
		{"dpkg", collectDpkg},
		{"rpm", collectRpm},
		{"pacman", collectPacman},
		{"apk", collectApk},
	} {
		pkgs, err := c.fn(ctx)
		if err == nil && len(pkgs) > 0 {
			return pkgs, c.source, nil
		}
	}
	return nil, "other", fmt.Errorf("no supported package manager found (dpkg/rpm/pacman/apk)")
}

// collectDpkg collects packages via dpkg-query.
func collectDpkg(ctx context.Context) ([]collectedPackage, error) {
	if _, err := exec.LookPath("dpkg-query"); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "dpkg-query", "-W",
		"-f=${Package}\t${Version}\t${Architecture}\t${Maintainer}\t${db-fsys:Last-Modified}\n")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var pkgs []collectedPackage
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		fields := strings.SplitN(scanner.Text(), "\t", 5)
		if len(fields) < 2 || fields[0] == "" {
			continue
		}
		p := collectedPackage{
			Name:      strings.TrimSpace(fields[0]),
			Version:   strings.TrimSpace(fields[1]),
			Arch:      trimField(fields, 2),
			Publisher: trimField(fields, 3),
		}
		if ts := trimField(fields, 4); ts != "" {
			if unix, err := strconv.ParseInt(ts, 10, 64); err == nil {
				p.InstallDate = unix
			}
		}
		if p.Name != "" && p.Version != "" {
			pkgs = append(pkgs, p)
		}
	}
	return pkgs, nil
}

// collectRpm collects packages via rpm.
func collectRpm(ctx context.Context) ([]collectedPackage, error) {
	if _, err := exec.LookPath("rpm"); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "rpm", "-qa",
		"--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\t%{VENDOR}\t%{INSTALLTIME}\n")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var pkgs []collectedPackage
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		fields := strings.SplitN(scanner.Text(), "\t", 5)
		if len(fields) < 2 {
			continue
		}
		p := collectedPackage{
			Name:      strings.TrimSpace(fields[0]),
			Version:   strings.TrimSpace(fields[1]),
			Arch:      trimField(fields, 2),
			Publisher: trimField(fields, 3),
		}
		if ts := trimField(fields, 4); ts != "" {
			if unix, err := strconv.ParseInt(ts, 10, 64); err == nil {
				p.InstallDate = unix
			}
		}
		if p.Name != "" && p.Version != "" {
			pkgs = append(pkgs, p)
		}
	}
	return pkgs, nil
}

// collectPacman collects packages via pacman.
func collectPacman(ctx context.Context) ([]collectedPackage, error) {
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
			pkgs = append(pkgs, collectedPackage{Name: parts[0], Version: parts[1]})
		}
	}
	return pkgs, nil
}

// collectApk collects packages via apk (Alpine Linux).
func collectApk(ctx context.Context) ([]collectedPackage, error) {
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
			pkgs = append(pkgs, collectedPackage{Name: name, Version: version})
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
