package checks

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// ServiceAccountConfig is the JSON config for a service_account check.
type ServiceAccountConfig struct {
	MinHumanUID int `json:"min_human_uid,omitempty"`
	MaxHumanUID int `json:"max_human_uid,omitempty"`
}

// ServiceAccountReport is the structured JSON payload for service account discovery.
type ServiceAccountReport struct {
	Accounts []AccountEntry `json:"accounts"`
	Error    string         `json:"error,omitempty"`
}

// AccountEntry describes a single system account discovered on the host.
type AccountEntry struct {
	Username             string `json:"username"`
	UID                  int    `json:"uid"`
	GID                  int    `json:"gid"`
	HomeDirectory        string `json:"home_directory"`
	Shell                string `json:"shell"`
	AccountType          string `json:"account_type"`
	HasLoginCapability   bool   `json:"has_login_capability"`
	HasRunningProcesses  bool   `json:"has_running_processes"`
	AccountLocked        bool   `json:"account_locked"`
	PasswordExpiresAt    string `json:"password_expires_at,omitempty"`
	PasswordLastChanged  string `json:"password_last_changed,omitempty"`
}

// shadowEntry holds parsed /etc/shadow fields for a user.
type shadowEntry struct {
	locked              bool
	passwordExpiresAt   string // ISO 8601 or empty
	passwordLastChanged string // ISO 8601 or empty
}

// noLoginShells lists shells that indicate no interactive login capability.
var noLoginShells = map[string]bool{
	"/usr/sbin/nologin": true,
	"/sbin/nologin":     true,
	"/bin/false":        true,
	"/usr/bin/false":    true,
}

func runServiceAccountCheck(cfg ServiceAccountConfig) (status, output string) {
	minHuman := cfg.MinHumanUID
	if minHuman <= 0 {
		minHuman = 1000
	}
	maxHuman := cfg.MaxHumanUID
	if maxHuman <= 0 {
		maxHuman = 60000
	}

	// Parse /etc/passwd
	f, err := os.Open("/etc/passwd")
	if err != nil {
		report := ServiceAccountReport{Error: fmt.Sprintf("reading /etc/passwd: %v", err)}
		out, _ := json.Marshal(report)
		return "error", string(out)
	}
	defer f.Close()

	// Build set of UIDs with running processes by scanning /proc
	runningUIDs := discoverRunningUIDs()

	// Parse /etc/shadow for password expiry and lock info (best effort, requires root)
	shadowInfo := parseShadowFile()

	var accounts []AccountEntry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Format: username:password:uid:gid:gecos:home:shell
		fields := strings.SplitN(line, ":", 7)
		if len(fields) < 7 {
			continue
		}

		username := fields[0]
		uid, err := strconv.Atoi(fields[2])
		if err != nil {
			continue
		}
		gid, _ := strconv.Atoi(fields[3])
		home := fields[5]
		shell := fields[6]

		hasLogin := !noLoginShells[shell]
		accountType := classifyAccount(uid, shell, minHuman, maxHuman)

		entry := AccountEntry{
			Username:            username,
			UID:                 uid,
			GID:                 gid,
			HomeDirectory:       home,
			Shell:               shell,
			AccountType:         accountType,
			HasLoginCapability:  hasLogin,
			HasRunningProcesses: runningUIDs[uid],
		}
		if si, ok := shadowInfo[username]; ok {
			entry.AccountLocked = si.locked
			entry.PasswordExpiresAt = si.passwordExpiresAt
			entry.PasswordLastChanged = si.passwordLastChanged
		}
		accounts = append(accounts, entry)
	}
	if err := scanner.Err(); err != nil {
		report := ServiceAccountReport{Error: fmt.Sprintf("scanning /etc/passwd: %v", err)}
		out, _ := json.Marshal(report)
		return "error", string(out)
	}

	report := ServiceAccountReport{Accounts: accounts}
	out, _ := json.Marshal(report)
	return "pass", string(out)
}

func classifyAccount(uid int, shell string, minHuman, maxHuman int) string {
	// Root and low UIDs are system accounts
	if uid == 0 {
		return "system"
	}
	// nologin shell makes it a service account regardless of UID
	if noLoginShells[shell] {
		if uid >= minHuman && uid <= maxHuman {
			return "service"
		}
		return "system"
	}
	// UID-based classification
	if uid < minHuman {
		return "system"
	}
	if uid <= maxHuman {
		return "human"
	}
	return "service"
}

// parseShadowFile reads /etc/shadow and extracts password expiry and lock
// information for each user. Returns an empty map if the file is not readable
// (e.g. the agent is not running as root).
func parseShadowFile() map[string]shadowEntry {
	result := make(map[string]shadowEntry)

	f, err := os.Open("/etc/shadow")
	if err != nil {
		return result // not root or file not present
	}
	defer f.Close()

	// Unix epoch for shadow dates is in days since 1970-01-01
	const secondsPerDay = 86400

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Format: username:password:lastchg:min:max:warn:inactive:expire:reserved
		fields := strings.SplitN(line, ":", 9)
		if len(fields) < 5 {
			continue
		}

		username := fields[0]
		passwordHash := fields[1]

		se := shadowEntry{}

		// Account is locked if password starts with ! or *
		se.locked = strings.HasPrefix(passwordHash, "!") || strings.HasPrefix(passwordHash, "*")

		// lastchg (field 2): days since epoch when password was last changed
		if lastChgDays, err := strconv.Atoi(fields[2]); err == nil && lastChgDays > 0 {
			lastChgTime := int64(lastChgDays) * secondsPerDay
			se.passwordLastChanged = fmt.Sprintf("%d", lastChgTime)
		}

		// max (field 4): max days password is valid. If set, password expires at lastchg + max
		if len(fields) >= 5 {
			maxDays, err := strconv.Atoi(fields[4])
			lastChgDays, err2 := strconv.Atoi(fields[2])
			if err == nil && err2 == nil && maxDays > 0 && maxDays < 99999 && lastChgDays > 0 {
				expiresAt := int64(lastChgDays+maxDays) * secondsPerDay
				se.passwordExpiresAt = fmt.Sprintf("%d", expiresAt)
			}
		}

		result[username] = se
	}

	return result
}

// discoverRunningUIDs scans /proc to find which UIDs have running processes.
// Returns an empty map on non-Linux systems where /proc is unavailable.
func discoverRunningUIDs() map[int]bool {
	result := make(map[int]bool)

	entries, err := os.ReadDir("/proc")
	if err != nil {
		return result // graceful degradation on non-Linux
	}

	for _, entry := range entries {
		if !entry.IsDir() || !isNumeric(entry.Name()) {
			continue
		}
		statusPath := "/proc/" + entry.Name() + "/status"
		data, err := os.ReadFile(statusPath)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "Uid:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					if uid, err := strconv.Atoi(fields[1]); err == nil {
						result[uid] = true
					}
				}
				break
			}
		}
	}

	return result
}
