package loadtest

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// Config is the fully-validated configuration for a load-test run.
type Config struct {
	Address           string
	EnrolmentToken    string
	CACertFile        string
	TLSSkipVerify     bool
	Agents            int
	Ramp              time.Duration
	Duration          time.Duration
	HeartbeatInterval time.Duration
	RunID             string
	HostnamePrefix    string
	ConnFanout        int
	StatsInterval     time.Duration
	RegistrationConc  int
	MetricsJitter     float64
	OutputJSON        string
	SimulateTasks     bool
	SimulateChecks    bool
	SimulateTerminal  bool
	SimulateInventory bool
	CheckFailureRate  float64
}

// Validate returns an error if the configuration is missing required fields
// or uses invalid values.
func (c *Config) Validate() error {
	if c.Address == "" {
		return fmt.Errorf("--address is required")
	}
	if c.EnrolmentToken == "" {
		return fmt.Errorf("--token is required")
	}
	if c.Agents < 1 {
		return fmt.Errorf("--agents must be >= 1")
	}
	if c.HeartbeatInterval < time.Second {
		return fmt.Errorf("--heartbeat-interval must be >= 1s")
	}
	if c.ConnFanout < 1 {
		return fmt.Errorf("--conn-fanout must be >= 1")
	}
	if c.RegistrationConc < 1 {
		return fmt.Errorf("--registration-concurrency must be >= 1")
	}
	if c.MetricsJitter < 0 || c.MetricsJitter > 1 {
		return fmt.Errorf("--metrics-jitter must be between 0 and 1")
	}
	if c.CheckFailureRate < 0 || c.CheckFailureRate > 1 {
		return fmt.Errorf("--check-failure-rate must be between 0 and 1")
	}
	return nil
}

// GenerateRunID returns a compact deterministic-looking identifier of the form
// "lt-YYMMDD-HHMMSS-XXXXXXXX" where the last eight characters are random hex,
// so concurrent load-test runs from the same wall-clock second still have
// distinct IDs. 4 random bytes (32 bits) gives ~2^-32 collision probability
// per pair, comfortably avoiding birthday-paradox flakes in tight loops.
func GenerateRunID() string {
	now := time.Now().UTC()
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("lt-%s-%s", now.Format("060102-150405"), hex.EncodeToString(b[:]))
}

// HostnameFor returns the fully-qualified virtual hostname for the agent at
// the given index within a run, e.g. "loadtest-lt-260418-143022-a3f1-0042".
func (c *Config) HostnameFor(index int) string {
	return fmt.Sprintf("%s-%s-%04d", c.HostnamePrefix, c.RunID, index)
}
