// Package updater handles automatic agent self-updates.
//
// When the ingest service signals that a newer agent version is available, this
// package downloads the new binary from the server, atomically replaces the
// current executable, and re-execs so the updated agent runs without a gap in
// monitoring.
//
// On failure at any step the error is returned to the caller. The caller must
// log it and continue — a failed update should never stop the agent.
package updater

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Update downloads the agent binary for the current OS/arch from downloadBaseURL,
// atomically replaces the running executable, and re-execs into the new binary.
// If it returns, an error occurred and the caller should continue running.
func Update(latestVersion, downloadBaseURL string) error {
	url := fmt.Sprintf(
		"%s?os=%s&arch=%s",
		downloadBaseURL,
		runtime.GOOS,
		runtime.GOARCH,
	)

	slog.Info("downloading agent update", "url", url, "version", latestVersion)

	// Determine current executable path.
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving current executable path: %w", err)
	}

	// Download to a temp file in the same directory so the rename is atomic
	// (same filesystem, no cross-device move).
	dir := filepath.Dir(exe)
	tmp, err := os.CreateTemp(dir, ".infrawatch-agent-update-*")
	if err != nil {
		return fmt.Errorf("creating temp file for update: %w", err)
	}
	tmpPath := tmp.Name()

	// Ensure the temp file is cleaned up on any error path.
	success := false
	defer func() {
		if !success {
			os.Remove(tmpPath)
		}
	}()

	resp, err := http.Get(url) //nolint:gosec // URL is constructed from server-supplied base URL
	if err != nil {
		tmp.Close()
		return fmt.Errorf("downloading update: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		tmp.Close()
		return fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		return fmt.Errorf("writing update to temp file: %w", err)
	}
	tmp.Close()

	// Make the new binary executable before replacing.
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		return fmt.Errorf("chmod update binary: %w", err)
	}

	// Atomic replace — rename is atomic within the same filesystem.
	if err := os.Rename(tmpPath, exe); err != nil {
		return fmt.Errorf("replacing binary (may need write permission on %s): %w", exe, err)
	}
	success = true

	slog.Info("update downloaded, restarting agent", "version", latestVersion)

	// Re-exec: start the new binary with the same arguments and environment,
	// then exit the current process. Using exec.Command + os.Exit rather than
	// syscall.Exec so this compiles and works on all target platforms including
	// Windows.
	cmd := exec.Command(exe, os.Args[1:]...) //nolint:gosec // exe is the path to our own binary
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("starting updated agent process: %w", err)
	}

	os.Exit(0)
	return nil // unreachable
}
