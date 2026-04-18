// Command infrawatch-loadtest simulates N virtual agents against a running
// Infrawatch server to measure sustainable fleet capacity on a given hardware
// profile. See docs/deployment/load-testing.md for the operator guide.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/infrawatch/agent/internal/loadtest"
)

func main() {
	if len(os.Args) < 2 {
		printRootUsage(os.Stderr)
		os.Exit(2)
	}

	switch os.Args[1] {
	case "run":
		exit(runCmd(os.Args[2:]))
	case "cleanup":
		exit(cleanupCmd(os.Args[2:]))
	case "-h", "--help", "help":
		printRootUsage(os.Stdout)
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n\n", os.Args[1])
		printRootUsage(os.Stderr)
		os.Exit(2)
	}
}

func exit(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func printRootUsage(w io.Writer) {
	fmt.Fprintln(w, "infrawatch-loadtest — simulate N virtual agents against an Infrawatch server")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Subcommands:")
	fmt.Fprintln(w, "  run      Start a load-test run")
	fmt.Fprintln(w, "  cleanup  Delete virtual hosts created by a prior run")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Run any subcommand with --help for its full flag list.")
}

func runCmd(args []string) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	cfg := &loadtest.Config{}
	fs.StringVar(&cfg.Address, "address", "", "ingest gRPC host:port (required)")
	fs.StringVar(&cfg.OrgToken, "token", "", "enrolment token with auto_approve=true (required)")
	fs.StringVar(&cfg.CACertFile, "ca-cert", "", "path to server CA cert (optional)")
	fs.BoolVar(&cfg.TLSSkipVerify, "tls-skip-verify", false, "skip TLS server verification (dev only)")
	fs.IntVar(&cfg.Agents, "agents", 100, "total virtual agents")
	fs.DurationVar(&cfg.Ramp, "ramp", 30*time.Second, "duration over which registrations are spread")
	fs.DurationVar(&cfg.Duration, "duration", 5*time.Minute, "how long to run; 0 = until Ctrl-C")
	fs.DurationVar(&cfg.HeartbeatInterval, "heartbeat-interval", 30*time.Second, "per-agent heartbeat cadence")
	runIDFlag := fs.String("run-id", "", "run identifier baked into hostnames; default = auto-generated")
	fs.StringVar(&cfg.HostnamePrefix, "hostname-prefix", "loadtest", "hostname prefix for virtual agents")
	fs.IntVar(&cfg.ConnFanout, "conn-fanout", 50, "virtual agents sharing a single gRPC connection")
	fs.DurationVar(&cfg.StatsInterval, "stats-interval", 10*time.Second, "cadence for live stats output")
	fs.IntVar(&cfg.RegistrationConc, "registration-concurrency", 32, "parallel Register RPCs in flight during ramp")
	fs.Float64Var(&cfg.MetricsJitter, "metrics-jitter", 0.1, "amplitude of per-tick metric drift (0-1)")
	fs.StringVar(&cfg.OutputJSON, "output-json", "", "optional path to write final summary as JSON")
	fs.BoolVar(&cfg.SimulateTasks, "simulate-tasks", true, "respond to server-pushed AgentTasks with fake progress + exit-0 result")
	fs.BoolVar(&cfg.SimulateChecks, "simulate-checks", true, "return fake CheckResults for pushed CheckDefinitions")
	fs.BoolVar(&cfg.SimulateTerminal, "simulate-terminal", true, "open Terminal streams for pushed TerminalSessionRequests")
	fs.BoolVar(&cfg.SimulateInventory, "simulate-inventory", true, "upload fake software inventory on software_inventory_scan tasks")
	fs.Float64Var(&cfg.CheckFailureRate, "check-failure-rate", 0.05, "fraction of simulated check results that report 'fail'")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: infrawatch-loadtest run [flags]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *runIDFlag != "" {
		cfg.RunID = *runIDFlag
	} else {
		cfg.RunID = loadtest.GenerateRunID()
	}
	if err := cfg.Validate(); err != nil {
		return err
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	runner := loadtest.NewRunner(cfg, os.Stdout)
	return runner.Run(ctx)
}

type bulkDeleteRequest struct {
	HostnamePrefix string `json:"hostnamePrefix"`
}

type bulkDeleteResponse struct {
	Deleted int      `json:"deleted"`
	Failed  []string `json:"failed"`
}

func cleanupCmd(args []string) error {
	fs := flag.NewFlagSet("cleanup", flag.ContinueOnError)
	webURL := fs.String("web-url", "", "base URL of the Infrawatch web app (required)")
	adminKey := fs.String("admin-key", "", "admin key configured via INFRAWATCH_LOADTEST_ADMIN_KEY on the web server (required)")
	runID := fs.String("run-id", "", "run-id of the load test to clean up (required)")
	hostnamePrefix := fs.String("hostname-prefix", "loadtest", "same prefix passed to `run`")
	timeout := fs.Duration("timeout", 5*time.Minute, "HTTP request timeout")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Usage: infrawatch-loadtest cleanup [flags]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *webURL == "" || *adminKey == "" || *runID == "" {
		fs.Usage()
		return errors.New("--web-url, --admin-key, and --run-id are required")
	}

	prefix := fmt.Sprintf("%s-%s-", *hostnamePrefix, *runID)
	reqBody, err := json.Marshal(bulkDeleteRequest{HostnamePrefix: prefix})
	if err != nil {
		return err
	}

	url := strings.TrimRight(*webURL, "/") + "/api/admin/hosts/bulk-delete"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Loadtest-Admin-Key", *adminKey)

	client := &http.Client{Timeout: *timeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("calling %s: %w", url, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("admin endpoint returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var out bulkDeleteResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	fmt.Printf("Deleted %d virtual hosts matching %s*\n", out.Deleted, prefix)
	if len(out.Failed) > 0 {
		fmt.Println("Failures:")
		for _, f := range out.Failed {
			fmt.Println("  -", f)
		}
	}
	return nil
}
