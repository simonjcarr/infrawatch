package heartbeat

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestDetectDockerStatusReportsNotInstalledWhenSocketMissing(t *testing.T) {
	status := detectDockerStatus(context.Background(), filepath.Join(t.TempDir(), "docker.sock"))

	if status.Status != agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_NOT_INSTALLED {
		t.Fatalf("status = %v, want not installed", status.Status)
	}
	if status.CheckedAtUnix == 0 {
		t.Fatal("checked_at_unix was not set")
	}
}

func TestDetectDockerStatusReportsPermissionDenied(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "docker.sock")
	if err := os.WriteFile(socketPath, []byte("not a socket"), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := func(context.Context, string) (dockerVersionInfo, error) {
		return dockerVersionInfo{}, &os.PathError{Op: "dial", Path: socketPath, Err: os.ErrPermission}
	}

	status := detectDockerStatusWithProbe(context.Background(), socketPath, probe)

	if status.Status != agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_PERMISSION_DENIED {
		t.Fatalf("status = %v, want permission denied", status.Status)
	}
}

func TestDetectDockerStatusReportsUnreachable(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "docker.sock")
	if err := os.WriteFile(socketPath, []byte("not a socket"), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := func(context.Context, string) (dockerVersionInfo, error) {
		return dockerVersionInfo{}, &net.OpError{Op: "dial", Net: "unix", Err: errors.New("connection refused")}
	}

	status := detectDockerStatusWithProbe(context.Background(), socketPath, probe)

	if status.Status != agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_UNREACHABLE {
		t.Fatalf("status = %v, want unreachable", status.Status)
	}
}

func TestDetectDockerStatusReportsInstalledWithVersionInfo(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "docker.sock")
	if err := os.WriteFile(socketPath, []byte("not a socket"), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := func(context.Context, string) (dockerVersionInfo, error) {
		return dockerVersionInfo{Version: "26.1.4", APIVersion: "1.45"}, nil
	}

	status := detectDockerStatusWithProbe(context.Background(), socketPath, probe)

	if status.Status != agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_INSTALLED {
		t.Fatalf("status = %v, want installed", status.Status)
	}
	if status.RuntimeVersion != "26.1.4" {
		t.Fatalf("runtime_version = %q, want 26.1.4", status.RuntimeVersion)
	}
	if status.ApiVersion != "1.45" {
		t.Fatalf("api_version = %q, want 1.45", status.ApiVersion)
	}
}

func TestDetectDockerStatusBoundsErrorMessage(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "docker.sock")
	if err := os.WriteFile(socketPath, []byte("not a socket"), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := func(context.Context, string) (dockerVersionInfo, error) {
		return dockerVersionInfo{}, errors.New(strings.Repeat("x", maxDockerStatusErrorBytes+32))
	}

	status := detectDockerStatusWithProbe(context.Background(), socketPath, probe)

	if status.Status != agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_ERROR {
		t.Fatalf("status = %v, want error", status.Status)
	}
	if len(status.ErrorMessage) > maxDockerStatusErrorBytes {
		t.Fatalf("error_message length = %d, want <= %d", len(status.ErrorMessage), maxDockerStatusErrorBytes)
	}
}
