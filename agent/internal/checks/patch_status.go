package checks

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"
)

type PatchStatusConfig struct {
	MaxAgeDays  int `json:"max_age_days"`
	MaxPackages int `json:"max_packages"`
}

type patchStatusUpdate struct {
	Name             string `json:"name"`
	CurrentVersion   string `json:"current_version,omitempty"`
	AvailableVersion string `json:"available_version,omitempty"`
	Architecture     string `json:"architecture,omitempty"`
	Repository       string `json:"repository,omitempty"`
}

type patchStatusReport struct {
	Status           string              `json:"status"`
	LastPatchedAt    string              `json:"last_patched_at,omitempty"`
	PatchAgeDays     int                 `json:"patch_age_days"`
	MaxAgeDays       int                 `json:"max_age_days"`
	PackageManager   string              `json:"package_manager,omitempty"`
	UpdatesSupported bool                `json:"updates_supported"`
	UpdatesCount     int                 `json:"updates_count"`
	UpdatesTruncated bool                `json:"updates_truncated"`
	Updates          []patchStatusUpdate `json:"updates"`
	Warnings         []string            `json:"warnings"`
	Error            string              `json:"error,omitempty"`
}

type patchStatusInput struct {
	Now              time.Time
	MaxAgeDays       int
	MaxPackages      int
	LastPatchedAt    time.Time
	PackageManager   string
	UpdatesSupported bool
	Updates          []patchStatusUpdate
	Warnings         []string
	Err              error
}

func runPatchStatusCheck(cfg PatchStatusConfig) (string, string) {
	if cfg.MaxAgeDays <= 0 {
		cfg.MaxAgeDays = 30
	}
	if cfg.MaxPackages <= 0 {
		cfg.MaxPackages = 500
	}
	if cfg.MaxPackages > 1000 {
		cfg.MaxPackages = 1000
	}

	input := patchStatusInput{
		Now:         time.Now().UTC(),
		MaxAgeDays:  cfg.MaxAgeDays,
		MaxPackages: cfg.MaxPackages,
	}

	var err error
	switch runtime.GOOS {
	case "windows":
		input.LastPatchedAt, err = latestWindowsHotfixDate()
		input.PackageManager = "windows_update"
		input.UpdatesSupported = false
		input.Warnings = append(input.Warnings, "available update listing is not supported on Windows")
	case "linux":
		input.PackageManager, err = detectPatchPackageManager()
		if err == nil {
			input.LastPatchedAt, err = latestLinuxPatchDate(input.PackageManager)
		}
		if err == nil {
			input.UpdatesSupported = true
			var updateErr error
			input.Updates, input.Warnings, updateErr = listLinuxUpdates(input.PackageManager, cfg.MaxPackages)
			if updateErr != nil {
				input.Warnings = append(input.Warnings, updateErr.Error())
			}
		}
	case "darwin":
		input.LastPatchedAt, err = latestMacOSPatchDate()
		input.PackageManager = "softwareupdate"
		input.UpdatesSupported = false
		input.Warnings = append(input.Warnings, "available update listing is not supported on macOS")
	default:
		err = fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
	input.Err = err

	report := buildPatchStatusReport(input)
	out, _ := json.Marshal(report)
	return report.Status, string(out)
}

func buildPatchStatusReport(input patchStatusInput) patchStatusReport {
	maxAge := input.MaxAgeDays
	if maxAge <= 0 {
		maxAge = 30
	}
	maxPackages := input.MaxPackages
	if maxPackages <= 0 {
		maxPackages = len(input.Updates)
	}

	report := patchStatusReport{
		Status:           "pass",
		MaxAgeDays:       maxAge,
		PackageManager:   input.PackageManager,
		UpdatesSupported: input.UpdatesSupported,
		Updates:          input.Updates,
		UpdatesCount:     len(input.Updates),
		Warnings:         append([]string(nil), input.Warnings...),
	}

	if input.Err != nil {
		report.Status = "error"
		report.Error = input.Err.Error()
		return report
	}
	if input.LastPatchedAt.IsZero() {
		report.Status = "error"
		report.Error = "last patch date could not be determined"
		return report
	}

	if len(report.Updates) > maxPackages {
		report.Updates = report.Updates[:maxPackages]
		report.UpdatesTruncated = true
	}
	report.UpdatesCount = len(input.Updates)
	report.LastPatchedAt = input.LastPatchedAt.UTC().Format(time.RFC3339)
	report.PatchAgeDays = int(input.Now.UTC().Sub(input.LastPatchedAt.UTC()).Hours() / 24)
	if report.PatchAgeDays < 0 {
		report.PatchAgeDays = 0
	}
	if report.PatchAgeDays > maxAge {
		report.Status = "fail"
	}
	return report
}

func detectPatchPackageManager() (string, error) {
	for _, probe := range []struct {
		binary string
		name   string
	}{
		{"apt", "apt"},
		{"apt-get", "apt"},
		{"dnf", "dnf"},
		{"yum", "yum"},
		{"zypper", "zypper"},
		{"pacman", "pacman"},
		{"apk", "apk"},
	} {
		if _, err := exec.LookPath(probe.binary); err == nil {
			return probe.name, nil
		}
	}
	return "", errors.New("no supported package manager found")
}

func latestLinuxPatchDate(pm string) (time.Time, error) {
	switch pm {
	case "apt":
		return latestFromLogs([]string{"/var/log/dpkg.log*", "/var/log/apt/history.log*"}, parseAptPatchLogLine)
	case "dnf":
		if t, err := latestCommandDate(12*time.Second, "dnf", "history", "list", "--reverse"); err == nil {
			return t, nil
		}
		return latestFromLogs([]string{"/var/log/dnf.log*"}, parseRpmPatchLogLine)
	case "yum":
		if t, err := latestCommandDate(12*time.Second, "yum", "history", "list", "all"); err == nil {
			return t, nil
		}
		return latestFromLogs([]string{"/var/log/yum.log*"}, parseYumPatchLogLine)
	case "zypper":
		return latestFromLogs([]string{"/var/log/zypp/history*"}, parseZypperPatchLogLine)
	case "pacman":
		return latestFromLogs([]string{"/var/log/pacman.log*"}, parsePacmanPatchLogLine)
	case "apk":
		return latestApkDBDate()
	default:
		return time.Time{}, fmt.Errorf("unsupported package manager: %s", pm)
	}
}

func latestFromLogs(patterns []string, parse func(string) (time.Time, bool)) (time.Time, error) {
	var latest time.Time
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		for _, path := range matches {
			info, err := os.Stat(path)
			if err != nil || info.IsDir() {
				continue
			}
			lines, err := readLogLines(path)
			if err != nil {
				continue
			}
			for _, line := range lines {
				if t, ok := parse(line); ok && t.After(latest) {
					latest = t
				}
			}
		}
	}
	if latest.IsZero() {
		return time.Time{}, errors.New("last patch date not found in package manager logs")
	}
	return latest, nil
}

func readLogLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var scanner *bufio.Scanner
	if strings.HasSuffix(path, ".gz") {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return nil, err
		}
		defer gz.Close()
		scanner = bufio.NewScanner(gz)
	} else {
		scanner = bufio.NewScanner(f)
	}
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines, scanner.Err()
}

func parseAptPatchLogLine(line string) (time.Time, bool) {
	if strings.HasPrefix(line, "Start-Date: ") {
		raw := strings.TrimSpace(strings.TrimPrefix(line, "Start-Date: "))
		raw = strings.Join(strings.Fields(raw), " ")
		if t, err := time.ParseInLocation("2006-01-02 15:04:05", raw, time.Local); err == nil {
			return t, true
		}
	}
	if !(strings.Contains(line, " upgrade ") || strings.Contains(line, " install ")) {
		return time.Time{}, false
	}
	if len(line) < 19 {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02 15:04:05", line[:19], time.Local)
	return t, err == nil
}

func parseRpmPatchLogLine(line string) (time.Time, bool) {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return time.Time{}, false
	}
	for _, layout := range []string{"2006-01-02T15:04:05-0700", "2006-01-02T15:04:05Z07:00"} {
		if t, err := time.Parse(layout, fields[0]); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func parseYumPatchLogLine(line string) (time.Time, bool) {
	fields := strings.Fields(line)
	if len(fields) < 3 || !(strings.Contains(line, " Updated: ") || strings.Contains(line, " Installed: ")) {
		return time.Time{}, false
	}
	raw := strings.Join(fields[:3], " ")
	t, err := time.ParseInLocation("Jan 02 15:04:05", raw, time.Local)
	if err != nil {
		return time.Time{}, false
	}
	now := time.Now()
	return time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.Local), true
}

func parseZypperPatchLogLine(line string) (time.Time, bool) {
	if !strings.Contains(line, "|install|") && !strings.Contains(line, "|update|") && !strings.Contains(line, "|patch|") {
		return time.Time{}, false
	}
	parts := strings.Split(line, "|")
	if len(parts) == 0 {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02 15:04:05", strings.TrimSpace(parts[0]), time.Local)
	return t, err == nil
}

func parsePacmanPatchLogLine(line string) (time.Time, bool) {
	if !strings.Contains(line, " upgraded ") && !strings.Contains(line, " installed ") {
		return time.Time{}, false
	}
	end := strings.Index(line, "]")
	if !strings.HasPrefix(line, "[") || end < 0 {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02T15:04:05-0700", line[1:end], time.Local)
	return t, err == nil
}

func latestApkDBDate() (time.Time, error) {
	info, err := os.Stat("/lib/apk/db/installed")
	if err != nil {
		return time.Time{}, fmt.Errorf("reading apk database timestamp: %w", err)
	}
	return info.ModTime(), nil
}

func latestCommandDate(timeout time.Duration, name string, args ...string) (time.Time, error) {
	out, err := runCommand(timeout, name, args...)
	if err != nil {
		return time.Time{}, err
	}
	var latest time.Time
	re := regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`)
	for _, match := range re.FindAllString(out, -1) {
		if t, err := time.Parse("2006-01-02", match); err == nil && t.After(latest) {
			latest = t
		}
	}
	if latest.IsZero() {
		return time.Time{}, errors.New("no date found in package manager history")
	}
	return latest, nil
}

func listLinuxUpdates(pm string, max int) ([]patchStatusUpdate, []string, error) {
	var output string
	var err error
	limit := max + 1
	if limit <= 1 {
		limit = 501
	}
	switch pm {
	case "apt":
		output, err = runCommand(15*time.Second, "apt", "list", "--upgradable")
		return parseAptUpgradable(output, limit), nil, err
	case "dnf":
		output, err = runCommandAllowExit(20*time.Second, []int{0, 100}, "dnf", "check-update", "--quiet")
		return parseRpmCheckUpdate(output, limit), nil, err
	case "yum":
		output, err = runCommandAllowExit(20*time.Second, []int{0, 100}, "yum", "check-update", "--quiet")
		return parseRpmCheckUpdate(output, limit), nil, err
	case "zypper":
		output, err = runCommandAllowExit(20*time.Second, []int{0, 100}, "zypper", "--non-interactive", "list-updates")
		return parseZypperUpdates(output, limit), nil, err
	case "pacman":
		output, err = runCommandAllowExit(20*time.Second, []int{0, 1}, "pacman", "-Qu")
		return parsePacmanUpdates(output, limit), nil, err
	case "apk":
		output, err = runCommandAllowExit(20*time.Second, []int{0}, "apk", "list", "--upgradable")
		return parseApkUpdates(output, limit), nil, err
	default:
		return nil, nil, fmt.Errorf("available update listing is not supported for %s", pm)
	}
}

func runCommand(timeout time.Duration, name string, args ...string) (string, error) {
	return runCommandAllowExit(timeout, []int{0}, name, args...)
}

func runCommandAllowExit(timeout time.Duration, allowed []int, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return stdout.String(), fmt.Errorf("%s timed out", name)
	}
	exit := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exit = ee.ExitCode()
		} else {
			return stdout.String(), err
		}
	}
	for _, code := range allowed {
		if exit == code {
			return stdout.String(), nil
		}
	}
	msg := strings.TrimSpace(stderr.String())
	if msg == "" {
		msg = fmt.Sprintf("%s exited with code %d", name, exit)
	}
	return stdout.String(), errors.New(msg)
}

func parseAptUpgradable(output string, max int) []patchStatusUpdate {
	var updates []patchStatusUpdate
	re := regexp.MustCompile(`^([^/\s]+)/\S+\s+(\S+)\s+(\S+).*?\[upgradable from:\s*([^\]]+)\]`)
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		m := re.FindStringSubmatch(strings.TrimSpace(scanner.Text()))
		if len(m) != 5 {
			continue
		}
		updates = append(updates, patchStatusUpdate{Name: m[1], AvailableVersion: m[2], Architecture: m[3], CurrentVersion: m[4]})
		if max > 0 && len(updates) >= max {
			break
		}
	}
	return updates
}

func parseRpmCheckUpdate(output string, max int) []patchStatusUpdate {
	var updates []patchStatusUpdate
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 || strings.Contains(fields[0], ":") || strings.HasPrefix(fields[0], "Last") {
			continue
		}
		name, arch := splitNameArch(fields[0])
		updates = append(updates, patchStatusUpdate{Name: name, Architecture: arch, AvailableVersion: fields[1], Repository: fieldAt(fields, 2)})
		if max > 0 && len(updates) >= max {
			break
		}
	}
	return updates
}

func parseZypperUpdates(output string, max int) []patchStatusUpdate {
	var updates []patchStatusUpdate
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "S ") || strings.HasPrefix(line, "--") {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 5 {
			continue
		}
		updates = append(updates, patchStatusUpdate{
			Repository:       strings.TrimSpace(parts[1]),
			Name:             strings.TrimSpace(parts[2]),
			CurrentVersion:   strings.TrimSpace(parts[3]),
			AvailableVersion: strings.TrimSpace(parts[4]),
			Architecture:     fieldAtTrimmed(parts, 5),
		})
		if max > 0 && len(updates) >= max {
			break
		}
	}
	return updates
}

func parsePacmanUpdates(output string, max int) []patchStatusUpdate {
	var updates []patchStatusUpdate
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 4 || fields[2] != "->" {
			continue
		}
		updates = append(updates, patchStatusUpdate{Name: fields[0], CurrentVersion: fields[1], AvailableVersion: fields[3]})
		if max > 0 && len(updates) >= max {
			break
		}
	}
	return updates
}

func parseApkUpdates(output string, max int) []patchStatusUpdate {
	var updates []patchStatusUpdate
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 {
			continue
		}
		name, version := splitApkUpdateNameVersion(fields[0])
		if name == "" {
			continue
		}
		updates = append(updates, patchStatusUpdate{Name: name, AvailableVersion: version})
		if max > 0 && len(updates) >= max {
			break
		}
	}
	return updates
}

func splitNameArch(s string) (string, string) {
	idx := strings.LastIndex(s, ".")
	if idx <= 0 || idx == len(s)-1 {
		return s, ""
	}
	return s[:idx], s[idx+1:]
}

func splitApkUpdateNameVersion(s string) (string, string) {
	for i := len(s) - 1; i > 0; i-- {
		if s[i] == '-' && i+1 < len(s) && s[i+1] >= '0' && s[i+1] <= '9' {
			return s[:i], s[i+1:]
		}
	}
	return s, ""
}

func fieldAt(fields []string, i int) string {
	if i >= len(fields) {
		return ""
	}
	return fields[i]
}

func fieldAtTrimmed(fields []string, i int) string {
	return strings.TrimSpace(fieldAt(fields, i))
}

func latestWindowsHotfixDate() (time.Time, error) {
	out, err := runCommand(20*time.Second, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		"Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1 HotFixID,InstalledOn | ConvertTo-Json -Compress")
	if err != nil {
		return time.Time{}, err
	}
	return parseWindowsHotfixJSON([]byte(out))
}

func parseWindowsHotfixJSON(data []byte) (time.Time, error) {
	var row struct {
		InstalledOn string `json:"InstalledOn"`
	}
	if err := json.Unmarshal(data, &row); err != nil {
		return time.Time{}, err
	}
	if strings.TrimSpace(row.InstalledOn) == "" {
		return time.Time{}, errors.New("hotfix installed date was empty")
	}
	if strings.HasPrefix(row.InstalledOn, "/Date(") {
		end := strings.Index(row.InstalledOn, ")/")
		if end > len("/Date(") {
			millis := row.InstalledOn[len("/Date("):end]
			if offset := strings.IndexAny(millis, "+-"); offset > 0 {
				millis = millis[:offset]
			}
			var value int64
			if _, err := fmt.Sscanf(millis, "%d", &value); err == nil {
				return time.UnixMilli(value), nil
			}
		}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "Monday, January 2, 2006 3:04:05 PM"} {
		if t, err := time.Parse(layout, row.InstalledOn); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported hotfix date format: %s", row.InstalledOn)
}

func latestMacOSPatchDate() (time.Time, error) {
	out, err := runCommand(15*time.Second, "softwareupdate", "--history")
	if err != nil {
		return time.Time{}, err
	}
	var latest time.Time
	re := regexp.MustCompile(`\b\d{2}/\d{2}/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b`)
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(strings.ToLower(line), "update") {
			continue
		}
		raw := string(re.Find([]byte(line)))
		if raw == "" {
			continue
		}
		var t time.Time
		var parseErr error
		if strings.Contains(raw, "/") {
			t, parseErr = time.Parse("01/02/2006", raw)
		} else {
			t, parseErr = time.Parse("2006-01-02", raw)
		}
		if parseErr == nil && t.After(latest) {
			latest = t
		}
	}
	if latest.IsZero() {
		return time.Time{}, errors.New("last macOS update date not found")
	}
	return latest, nil
}

func sortedUpdates(updates []patchStatusUpdate) []patchStatusUpdate {
	out := append([]patchStatusUpdate(nil), updates...)
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out
}
