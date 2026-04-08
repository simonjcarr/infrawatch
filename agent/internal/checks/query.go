package checks

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// RunQuery executes a one-shot enumeration query and returns its result.
// It is called inline from the heartbeat runner and should complete within
// a few seconds at most (subprocess exec + line parsing).
func RunQuery(q *agentv1.AgentQuery) *agentv1.AgentQueryResult {
	result := &agentv1.AgentQueryResult{
		QueryId:   q.QueryId,
		QueryType: q.QueryType,
	}
	switch q.QueryType {
	case "list_ports":
		ports, err := listOpenPorts()
		if err != nil {
			result.Status = "error"
			result.Error = err.Error()
			return result
		}
		result.Status = "ok"
		result.Ports = ports
	case "list_services":
		services, err := listRunningServices()
		if err != nil {
			result.Status = "error"
			result.Error = err.Error()
			return result
		}
		result.Status = "ok"
		result.Services = services
	default:
		result.Status = "error"
		result.Error = "unknown query type: " + q.QueryType
	}
	return result
}

// listOpenPorts runs `ss -tlnp` (preferred) or falls back to `netstat -tlnp`,
// parsing TCP listening ports and their binding process names.
func listOpenPorts() ([]*agentv1.PortInfo, error) {
	out, err := exec.Command("ss", "-tlnp").Output()
	if err != nil {
		// Fallback to netstat for minimal images lacking iproute2.
		out, err = exec.Command("netstat", "-tlnp").Output()
		if err != nil {
			return nil, fmt.Errorf("neither 'ss' nor 'netstat' available: %w", err)
		}
	}

	seen := make(map[string]struct{})
	var ports []*agentv1.PortInfo
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		// Both `ss` and `netstat` emit a LISTEN line; `ss` has it as the first
		// column, `netstat` as the sixth. We match either.
		if !strings.Contains(line, "LISTEN") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		// Find the local-address column. For `ss -tlnp` it's fields[3];
		// for `netstat -tlnp` it's fields[3] as well.
		localAddr := fields[3]
		colonIdx := strings.LastIndex(localAddr, ":")
		if colonIdx < 0 {
			continue
		}
		portStr := localAddr[colonIdx+1:]
		portNum, err := strconv.ParseInt(portStr, 10, 32)
		if err != nil {
			continue
		}

		// Process name: ss puts it in the last column as users:(("name",pid=N,fd=M))
		// netstat puts it in the last column as PID/name.
		process := ""
		if len(fields) >= 5 {
			process = extractProcessName(fields[len(fields)-1])
		}

		// Deduplicate across IPv4/IPv6 duals on the same port+process.
		key := fmt.Sprintf("%d|%s", portNum, process)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}

		ports = append(ports, &agentv1.PortInfo{
			Port:     int32(portNum),
			Protocol: "tcp",
			Process:  process,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return ports, nil
}

// extractProcessName parses the process column emitted by ss or netstat.
// ss format:      users:(("nginx",pid=123,fd=5))
// netstat format: 123/nginx
// Returns "" if no name can be extracted.
func extractProcessName(s string) string {
	// ss: quoted name between the first pair of double-quotes
	if strings.Contains(s, `"`) {
		start := strings.Index(s, `"`)
		if start < 0 {
			return ""
		}
		end := strings.Index(s[start+1:], `"`)
		if end < 0 {
			return ""
		}
		return s[start+1 : start+1+end]
	}
	// netstat: PID/name
	if idx := strings.Index(s, "/"); idx >= 0 && idx+1 < len(s) {
		return s[idx+1:]
	}
	return ""
}

// listRunningServices runs `systemctl list-units --type=service --state=running`
// and parses the output. Returns a friendly error if systemd is not present.
func listRunningServices() ([]*agentv1.ServiceInfo, error) {
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return nil, fmt.Errorf("systemd is not available on this host")
	}

	cmd := exec.Command("systemctl",
		"list-units",
		"--type=service",
		"--state=running",
		"--no-pager",
		"--no-legend",
		"--plain",
	)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("systemctl failed: %w", err)
	}

	var services []*agentv1.ServiceInfo
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		// Columns: UNIT LOAD ACTIVE SUB DESCRIPTION...
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		services = append(services, &agentv1.ServiceInfo{
			Name:      fields[0],
			LoadState: fields[1],
			ActiveSub: fields[3],
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return services, nil
}
