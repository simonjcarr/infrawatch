package checks

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// HttpConfig is the JSON config for an HTTP check.
type HttpConfig struct {
	URL            string `json:"url"`
	ExpectedStatus int    `json:"expected_status"`
}

// httpClient is shared across all HTTP checks so that the underlying transport
// and its connection pool are reused rather than recreated on every execution.
// Without this, each check invocation creates a new Transport whose idle
// connections hold open file descriptors until the GC finalises the object —
// over hours of operation this exhausts the process's FD limit.
var httpClient = &http.Client{Timeout: 10 * time.Second}

func runHttpCheck(cfg HttpConfig) (status, output string) {
	resp, err := httpClient.Get(cfg.URL)
	if err != nil {
		return "fail", fmt.Sprintf("request failed: %v", err)
	}
	// Drain the body before closing so the Transport can reuse the connection.
	// Without this the underlying TCP connection cannot be cleanly returned to
	// the pool and accumulates as a leaked file descriptor.
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	expected := cfg.ExpectedStatus
	if expected == 0 {
		expected = 200
	}

	if resp.StatusCode == expected {
		return "pass", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return "fail", fmt.Sprintf("expected HTTP %d, got %d", expected, resp.StatusCode)
}
