package heartbeat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const (
	defaultDockerSocketPath   = "/var/run/docker.sock"
	dockerStatusProbeTimeout  = 2 * time.Second
	maxDockerStatusErrorBytes = 512
)

type dockerVersionInfo struct {
	Version    string `json:"Version"`
	APIVersion string `json:"ApiVersion"`
}

type dockerVersionProbe func(context.Context, string) (dockerVersionInfo, error)

func detectDockerStatus(ctx context.Context, socketPath string) *agentv1.DockerStatus {
	return detectDockerStatusWithProbe(ctx, socketPath, probeDockerVersion)
}

func detectDockerStatusWithProbe(ctx context.Context, socketPath string, probe dockerVersionProbe) *agentv1.DockerStatus {
	status := &agentv1.DockerStatus{
		CheckedAtUnix: time.Now().Unix(),
	}

	if _, err := os.Stat(socketPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			status.Status = agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_NOT_INSTALLED
			return status
		}
		if errors.Is(err, os.ErrPermission) {
			status.Status = agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_PERMISSION_DENIED
			status.ErrorMessage = boundDockerStatusError(err)
			return status
		}
		status.Status = agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_ERROR
		status.ErrorMessage = boundDockerStatusError(err)
		return status
	}

	probeCtx, cancel := context.WithTimeout(ctx, dockerStatusProbeTimeout)
	defer cancel()
	version, err := probe(probeCtx, socketPath)
	if err != nil {
		status.Status = classifyDockerProbeError(err)
		status.ErrorMessage = boundDockerStatusError(err)
		return status
	}

	status.Status = agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_INSTALLED
	status.RuntimeVersion = truncateUTF8(version.Version, 64)
	status.ApiVersion = truncateUTF8(version.APIVersion, 32)
	return status
}

func probeDockerVersion(ctx context.Context, socketPath string) (dockerVersionInfo, error) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socketPath)
		},
	}
	defer transport.CloseIdleConnections()

	client := &http.Client{Transport: transport}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker/version", nil)
	if err != nil {
		return dockerVersionInfo{}, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return dockerVersionInfo{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return dockerVersionInfo{}, os.ErrPermission
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return dockerVersionInfo{}, fmt.Errorf("docker version endpoint returned HTTP %d", resp.StatusCode)
	}

	var version dockerVersionInfo
	if err := json.NewDecoder(resp.Body).Decode(&version); err != nil {
		return dockerVersionInfo{}, err
	}
	return version, nil
}

func classifyDockerProbeError(err error) agentv1.DockerRuntimeStatus {
	if errors.Is(err, os.ErrPermission) {
		return agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_PERMISSION_DENIED
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "connection refused") {
		return agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_UNREACHABLE
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_UNREACHABLE
	}
	return agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_ERROR
}

func boundDockerStatusError(err error) string {
	if err == nil {
		return ""
	}
	return truncateUTF8(err.Error(), maxDockerStatusErrorBytes)
}
