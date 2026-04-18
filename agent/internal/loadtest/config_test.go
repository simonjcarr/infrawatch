package loadtest

import (
	"strings"
	"testing"
	"time"
)

func validConfig() *Config {
	return &Config{
		Address:           "localhost:9443",
		OrgToken:          "test-token",
		Agents:            10,
		HeartbeatInterval: 30 * time.Second,
		ConnFanout:        5,
		RegistrationConc:  4,
		MetricsJitter:     0.1,
		CheckFailureRate:  0.05,
		HostnamePrefix:    "loadtest",
		RunID:             "lt-test",
	}
}

func TestConfigValidateHappyPath(t *testing.T) {
	if err := validConfig().Validate(); err != nil {
		t.Fatalf("expected valid config, got: %v", err)
	}
}

func TestConfigValidateRejectsMissingFields(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{"no address", func(c *Config) { c.Address = "" }, "--address"},
		{"no token", func(c *Config) { c.OrgToken = "" }, "--token"},
		{"zero agents", func(c *Config) { c.Agents = 0 }, "--agents"},
		{"hb too fast", func(c *Config) { c.HeartbeatInterval = 500 * time.Millisecond }, "--heartbeat-interval"},
		{"jitter too high", func(c *Config) { c.MetricsJitter = 1.5 }, "--metrics-jitter"},
		{"failure rate < 0", func(c *Config) { c.CheckFailureRate = -0.1 }, "--check-failure-rate"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := validConfig()
			tc.mutate(c)
			err := c.Validate()
			if err == nil {
				t.Fatalf("expected validation error for %q", tc.name)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q did not mention %q", err.Error(), tc.want)
			}
		})
	}
}

func TestHostnameForFormat(t *testing.T) {
	c := &Config{HostnamePrefix: "loadtest", RunID: "lt-261117-x"}
	got := c.HostnameFor(42)
	want := "loadtest-lt-261117-x-0042"
	if got != want {
		t.Fatalf("HostnameFor(42): got %q, want %q", got, want)
	}
}

func TestGenerateRunIDUniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := GenerateRunID()
		if seen[id] {
			t.Fatalf("duplicate run ID generated: %s", id)
		}
		seen[id] = true
		if !strings.HasPrefix(id, "lt-") {
			t.Fatalf("run ID missing 'lt-' prefix: %s", id)
		}
	}
}
