// Package agentv1 contains the message types and gRPC service definitions for
// the Infrawatch agent protocol.
//
// NOTE: These are hand-written stubs that use a JSON codec override so they
// compile and work without running protoc. Run `make proto` to regenerate
// proper protobuf-encoded versions from the .proto sources.
package agentv1

// PlatformInfo carries host platform details reported by the agent.
type PlatformInfo struct {
	Os          string   `json:"os"`
	Arch        string   `json:"arch"`
	OsVersion   string   `json:"os_version"`
	IpAddresses []string `json:"ip_addresses"`
}

// AgentInfo identifies the agent binary itself.
type AgentInfo struct {
	AgentId  string `json:"agent_id"`
	Version  string `json:"version"`
	Hostname string `json:"hostname"`
}

// RegisterRequest is sent by the agent to register itself with the ingest service.
type RegisterRequest struct {
	OrgToken     string        `json:"org_token"`
	PublicKey    string        `json:"public_key"`
	PlatformInfo *PlatformInfo `json:"platform_info"`
	AgentInfo    *AgentInfo    `json:"agent_info"`
}

// RegisterResponse is returned by the ingest service after a registration attempt.
type RegisterResponse struct {
	AgentId   string `json:"agent_id"`
	Status    string `json:"status"`
	Message   string `json:"message"`
	JwtToken  string `json:"jwt_token"`
}

// DiskInfo describes a single mounted filesystem.
type DiskInfo struct {
	MountPoint  string  `json:"mount_point"`
	Device      string  `json:"device"`
	FsType      string  `json:"fs_type"`
	TotalBytes  uint64  `json:"total_bytes"`
	UsedBytes   uint64  `json:"used_bytes"`
	FreeBytes   uint64  `json:"free_bytes"`
	PercentUsed float32 `json:"percent_used"`
}

// NetworkInterface describes a single network adapter.
type NetworkInterface struct {
	Name        string   `json:"name"`
	IpAddresses []string `json:"ip_addresses"`
	MacAddress  string   `json:"mac_address"`
	IsUp        bool     `json:"is_up"`
}

// CheckDefinition is pushed from the server to instruct the agent to run a check.
type CheckDefinition struct {
	CheckID         string `json:"check_id"`
	CheckType       string `json:"check_type"`
	ConfigJSON      string `json:"config_json"`
	IntervalSeconds int32  `json:"interval_seconds"`
}

// CheckResult is reported by the agent after executing a check.
type CheckResult struct {
	CheckID    string `json:"check_id"`
	Status     string `json:"status"`
	Output     string `json:"output"`
	DurationMs int32  `json:"duration_ms"`
	RanAtUnix  int64  `json:"ran_at_unix"`
}

// HeartbeatRequest is sent by the agent on each heartbeat interval.
type HeartbeatRequest struct {
	AgentId           string             `json:"agent_id"`
	CpuPercent        float32            `json:"cpu_percent"`
	MemoryPercent     float32            `json:"memory_percent"`
	DiskPercent       float32            `json:"disk_percent"`
	UptimeSeconds     int64              `json:"uptime_seconds"`
	TimestampUnix     int64              `json:"timestamp_unix"`
	AgentVersion      string             `json:"agent_version"`
	OsVersion         string             `json:"os_version"`
	Os                string             `json:"os"`
	Arch              string             `json:"arch"`
	Disks             []DiskInfo         `json:"disks"`
	NetworkInterfaces []NetworkInterface `json:"network_interfaces"`
	CheckResults      []CheckResult      `json:"check_results"`
}

// HeartbeatResponse is sent back by the server on each heartbeat tick.
type HeartbeatResponse struct {
	Ok              bool              `json:"ok"`
	Command         string            `json:"command"`
	CommandPayload  []byte            `json:"command_payload"`
	LatestVersion   string            `json:"latest_version"`
	UpdateAvailable bool              `json:"update_available"`
	DownloadURL     string            `json:"download_url"`
	Checks          []CheckDefinition `json:"checks"`
}
