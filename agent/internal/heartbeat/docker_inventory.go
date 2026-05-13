package heartbeat

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const (
	dockerInventoryTimeout          = 5 * time.Second
	defaultMaxDockerLabelBytes      = 16 * 1024
	MaxDockerInventoryItemsPerBatch = 1000
	maxDockerContainerIDBytes       = 128
	maxDockerContainerNameBytes     = 256
	maxDockerContainerImageBytes    = 512
	maxDockerContainerImageIDBytes  = 512
	maxDockerContainerStateBytes    = 64
	maxDockerContainerStatusBytes   = 512
	maxDockerContainerLabelKeyBytes = 256
)

type dockerContainerListItem struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	ImageID string            `json:"ImageID"`
	Labels  map[string]string `json:"Labels"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Created int64             `json:"Created"`
}

type dockerContainerInspect struct {
	RestartCount int32                       `json:"RestartCount"`
	State        dockerContainerInspectState `json:"State"`
}

type dockerContainerInspectState struct {
	StartedAt  string `json:"StartedAt"`
	FinishedAt string `json:"FinishedAt"`
}

func collectDockerInventory(ctx context.Context, socketPath string, maxLabelBytes int) ([]*agentv1.DockerContainerInventory, error) {
	ctx, cancel := context.WithTimeout(ctx, dockerInventoryTimeout)
	defer cancel()
	return collectDockerInventoryWithClient(ctx, dockerSocketHTTPClient(socketPath), "http://docker", maxLabelBytes)
}

func collectDockerInventoryWithClient(ctx context.Context, client *http.Client, baseURL string, maxLabelBytes int) ([]*agentv1.DockerContainerInventory, error) {
	if maxLabelBytes <= 0 {
		maxLabelBytes = defaultMaxDockerLabelBytes
	}

	listURL, err := url.JoinPath(baseURL, "/containers/json")
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL+"?all=1", nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, os.ErrPermission
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("docker containers endpoint returned HTTP %d", resp.StatusCode)
	}

	var containers []dockerContainerListItem
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return nil, err
	}

	observedAt := time.Now().Unix()
	inventory := make([]*agentv1.DockerContainerInventory, 0, len(containers))
	for _, container := range containers {
		item := dockerInventoryFromListItem(container, observedAt, maxLabelBytes)
		if inspect, err := inspectDockerContainer(ctx, client, baseURL, container.ID); err == nil {
			item.StartedAtUnix = parseDockerTimestampUnix(inspect.State.StartedAt)
			item.FinishedAtUnix = parseDockerTimestampUnix(inspect.State.FinishedAt)
			item.RestartCount = inspect.RestartCount
		}
		inventory = append(inventory, item)
	}
	return inventory, nil
}

func dockerInventoryFromListItem(container dockerContainerListItem, observedAt int64, maxLabelBytes int) *agentv1.DockerContainerInventory {
	return &agentv1.DockerContainerInventory{
		DockerContainerId: truncateUTF8(strings.TrimSpace(container.ID), maxDockerContainerIDBytes),
		Names:             normalizeDockerNames(container.Names),
		Image:             truncateUTF8(strings.TrimSpace(container.Image), maxDockerContainerImageBytes),
		ImageId:           truncateUTF8(strings.TrimSpace(container.ImageID), maxDockerContainerImageIDBytes),
		Labels:            boundedDockerLabels(container.Labels, maxLabelBytes),
		State:             truncateUTF8(strings.TrimSpace(container.State), maxDockerContainerStateBytes),
		Status:            truncateUTF8(strings.TrimSpace(container.Status), maxDockerContainerStatusBytes),
		CreatedAtUnix:     container.Created,
		ObservedAtUnix:    observedAt,
	}
}

func inspectDockerContainer(ctx context.Context, client *http.Client, baseURL, containerID string) (dockerContainerInspect, error) {
	inspectURL, err := url.JoinPath(baseURL, "/containers", containerID, "json")
	if err != nil {
		return dockerContainerInspect{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, inspectURL, nil)
	if err != nil {
		return dockerContainerInspect{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return dockerContainerInspect{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return dockerContainerInspect{}, os.ErrPermission
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return dockerContainerInspect{}, fmt.Errorf("docker inspect endpoint returned HTTP %d", resp.StatusCode)
	}

	var inspect dockerContainerInspect
	if err := json.NewDecoder(resp.Body).Decode(&inspect); err != nil {
		return dockerContainerInspect{}, err
	}
	return inspect, nil
}

func dockerSocketHTTPClient(socketPath string) *http.Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socketPath)
		},
	}
	return &http.Client{Transport: transport}
}

func normalizeDockerNames(names []string) []string {
	normalized := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(strings.TrimPrefix(name, "/"))
		if name == "" {
			continue
		}
		normalized = append(normalized, truncateUTF8(name, maxDockerContainerNameBytes))
	}
	return normalized
}

func boundedDockerLabels(labels map[string]string, maxBytes int) []*agentv1.DockerContainerLabel {
	if maxBytes <= 0 || len(labels) == 0 {
		return nil
	}
	keys := make([]string, 0, len(labels))
	for key := range labels {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	out := make([]*agentv1.DockerContainerLabel, 0, len(keys))
	used := 0
	for _, originalKey := range keys {
		key := truncateUTF8(strings.TrimSpace(originalKey), maxDockerContainerLabelKeyBytes)
		if key == "" {
			continue
		}
		remaining := maxBytes - used - len(key)
		if remaining < 0 {
			break
		}
		value := truncateUTF8(labels[originalKey], remaining)
		out = append(out, &agentv1.DockerContainerLabel{Key: key, Value: value})
		used += len(key) + len(value)
		if used >= maxBytes {
			break
		}
	}
	return out
}

func parseDockerTimestampUnix(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "0001-01-01T00:00:00") {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return t.Unix()
}
