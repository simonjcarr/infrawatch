package heartbeat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestCollectDockerInventoryIncludesContainerDetails(t *testing.T) {
	handler := http.NewServeMux()
	handler.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("all") != "1" {
			t.Fatalf("all query = %q, want 1", r.URL.Query().Get("all"))
		}
		_ = json.NewEncoder(w).Encode([]dockerContainerListItem{
			{
				ID:      "abcdef123456",
				Names:   []string{"/web", "worker"},
				Image:   "nginx:1.27",
				ImageID: "sha256:image",
				Labels:  map[string]string{"com.example.role": "frontend", "tier": "edge"},
				State:   "running",
				Status:  "Up 2 minutes",
				Created: 1_778_611_200,
			},
		})
	})
	handler.HandleFunc("/containers/abcdef123456/json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(dockerContainerInspect{
			RestartCount: 3,
			State: dockerContainerInspectState{
				StartedAt:  "2026-05-12T20:00:05.123456789Z",
				FinishedAt: "0001-01-01T00:00:00Z",
			},
		})
	})
	server := httptest.NewServer(handler)
	defer server.Close()

	inventory, err := collectDockerInventoryWithClient(context.Background(), server.Client(), server.URL, 1024)
	if err != nil {
		t.Fatalf("collectDockerInventoryWithClient() error = %v", err)
	}
	if len(inventory) != 1 {
		t.Fatalf("inventory length = %d, want 1", len(inventory))
	}

	got := inventory[0]
	if got.DockerContainerId != "abcdef123456" {
		t.Fatalf("docker_container_id = %q", got.DockerContainerId)
	}
	if got.Names[0] != "web" || got.Names[1] != "worker" {
		t.Fatalf("names = %#v, want normalized names", got.Names)
	}
	if got.Image != "nginx:1.27" || got.ImageId != "sha256:image" {
		t.Fatalf("image fields = %q/%q", got.Image, got.ImageId)
	}
	if got.State != "running" || got.Status != "Up 2 minutes" {
		t.Fatalf("state/status = %q/%q", got.State, got.Status)
	}
	if got.CreatedAtUnix != 1_778_611_200 {
		t.Fatalf("created_at_unix = %d", got.CreatedAtUnix)
	}
	if got.StartedAtUnix != 1_778_616_005 {
		t.Fatalf("started_at_unix = %d", got.StartedAtUnix)
	}
	if got.FinishedAtUnix != 0 {
		t.Fatalf("finished_at_unix = %d, want zero for Docker zero time", got.FinishedAtUnix)
	}
	if got.ObservedAtUnix == 0 {
		t.Fatal("observed_at_unix was not set")
	}
	if got.RestartCount != 3 {
		t.Fatalf("restart_count = %d, want 3", got.RestartCount)
	}
	assertDockerLabel(t, got, "com.example.role", "frontend")
	assertDockerLabel(t, got, "tier", "edge")
}

func TestCollectDockerInventoryBoundsLabels(t *testing.T) {
	handler := http.NewServeMux()
	handler.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]dockerContainerListItem{
			{
				ID:     "abcdef123456",
				Labels: map[string]string{"aaa": "12345", "bbb": "1234567890", "ccc": "ignored"},
			},
		})
	})
	handler.HandleFunc("/containers/abcdef123456/json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(dockerContainerInspect{})
	})
	server := httptest.NewServer(handler)
	defer server.Close()

	inventory, err := collectDockerInventoryWithClient(context.Background(), server.Client(), server.URL, 12)
	if err != nil {
		t.Fatalf("collectDockerInventoryWithClient() error = %v", err)
	}

	labels := inventory[0].Labels
	if len(labels) != 2 {
		t.Fatalf("labels length = %d, want 2 labels within byte budget", len(labels))
	}
	if labels[0].Key != "aaa" || labels[0].Value != "12345" {
		t.Fatalf("first label = %#v", labels[0])
	}
	if labels[1].Key != "bbb" || labels[1].Value != "1" {
		t.Fatalf("second label = %#v, want truncated value", labels[1])
	}
}

func assertDockerLabel(t *testing.T, inventory *agentv1.DockerContainerInventory, key, value string) {
	t.Helper()
	for _, label := range inventory.Labels {
		if label.Key == key && label.Value == value {
			return
		}
	}
	t.Fatalf("missing label %q=%q in %#v", key, value, inventory.Labels)
}
