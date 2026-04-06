package checks

import (
	"fmt"
	"net/http"
	"time"
)

// HttpConfig is the JSON config for an HTTP check.
type HttpConfig struct {
	URL            string `json:"url"`
	ExpectedStatus int    `json:"expected_status"`
}

func runHttpCheck(cfg HttpConfig) (status, output string) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(cfg.URL)
	if err != nil {
		return "fail", fmt.Sprintf("request failed: %v", err)
	}
	defer resp.Body.Close()

	expected := cfg.ExpectedStatus
	if expected == 0 {
		expected = 200
	}

	if resp.StatusCode == expected {
		return "pass", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return "fail", fmt.Sprintf("expected HTTP %d, got %d", expected, resp.StatusCode)
}
