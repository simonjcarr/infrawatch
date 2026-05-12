package queries

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestDockerContainerInventoryReportsFromProtoNormalizesInventory(t *testing.T) {
	t.Parallel()

	receivedAt := time.Date(2026, 5, 13, 9, 30, 0, 0, time.UTC)
	reports := DockerContainerInventoryReportsFromProto([]*agentv1.DockerContainerInventory{
		nil,
		{
			DockerContainerId: " abcdef123456 ",
			Names:             []string{" /web ", "/web", "", "/api"},
			Image:             " nginx:latest ",
			ImageId:           strings.Repeat("i", maxDockerContainerImageIDBytes+20),
			Labels: []*agentv1.DockerContainerLabel{
				nil,
				{Key: " com.example.role ", Value: " frontend "},
				{Key: "", Value: "ignored"},
			},
			State:          " running ",
			Status:         strings.Repeat("世", maxDockerContainerStatusBytes),
			CreatedAtUnix:  receivedAt.Add(-time.Hour).Unix(),
			StartedAtUnix:  receivedAt.Add(-time.Minute).Unix(),
			ObservedAtUnix: receivedAt.Add(-30 * time.Second).Unix(),
			RestartCount:   3,
		},
		{DockerContainerId: " "},
	}, receivedAt)

	if len(reports) != 1 {
		t.Fatalf("len(reports) = %d, want 1", len(reports))
	}
	got := reports[0]
	if got.DockerContainerID != "abcdef123456" {
		t.Fatalf("DockerContainerID = %q, want normalized id", got.DockerContainerID)
	}
	if got.PrimaryName != "web" {
		t.Fatalf("PrimaryName = %q, want web", got.PrimaryName)
	}
	if len(got.Names) != 2 || got.Names[0] != "web" || got.Names[1] != "api" {
		t.Fatalf("Names = %#v, want deduped Docker names", got.Names)
	}
	if got.Image != "nginx:latest" {
		t.Fatalf("Image = %q, want nginx:latest", got.Image)
	}
	if len(got.ImageID) > maxDockerContainerImageIDBytes {
		t.Fatalf("ImageID length = %d, want <= %d", len(got.ImageID), maxDockerContainerImageIDBytes)
	}
	if got.Labels["com.example.role"] != " frontend " {
		t.Fatalf("Labels = %#v, want trimmed key with original value", got.Labels)
	}
	if got.State != "running" {
		t.Fatalf("State = %q, want running", got.State)
	}
	if len(got.Status) > maxDockerContainerStatusBytes {
		t.Fatalf("Status length = %d, want <= %d", len(got.Status), maxDockerContainerStatusBytes)
	}
	if !utf8.ValidString(got.Status) {
		t.Fatal("Status is not valid UTF-8")
	}
	if got.CreatedAtSource == nil || !got.CreatedAtSource.Equal(receivedAt.Add(-time.Hour)) {
		t.Fatalf("CreatedAtSource = %v, want source time", got.CreatedAtSource)
	}
	if got.FinishedAtSource != nil {
		t.Fatalf("FinishedAtSource = %v, want nil for zero timestamp", got.FinishedAtSource)
	}
	if !got.ObservedAt.Equal(receivedAt.Add(-30 * time.Second)) {
		t.Fatalf("ObservedAt = %s, want reported observation time", got.ObservedAt)
	}
	if got.RestartCount != 3 {
		t.Fatalf("RestartCount = %d, want 3", got.RestartCount)
	}
}

func TestDockerContainerInventoryReportsFromProtoBoundsNamesAndLabels(t *testing.T) {
	t.Parallel()

	names := make([]string, 0, maxDockerContainerNames+5)
	for i := 0; i < maxDockerContainerNames+5; i++ {
		names = append(names, string(rune('a'+i))+strings.Repeat("n", maxDockerContainerNameBytes+20))
	}
	labels := make([]*agentv1.DockerContainerLabel, 0, maxDockerContainerLabels+5)
	for i := 0; i < maxDockerContainerLabels+5; i++ {
		labels = append(labels, &agentv1.DockerContainerLabel{
			Key:   string(rune('a'+i)) + strings.Repeat("k", maxDockerContainerLabelKeyBytes+20),
			Value: strings.Repeat("v", maxDockerContainerLabelValueBytes+20),
		})
	}

	reports := DockerContainerInventoryReportsFromProto([]*agentv1.DockerContainerInventory{{
		DockerContainerId: "container-1",
		Names:             names,
		Labels:            labels,
	}}, time.Date(2026, 5, 13, 9, 30, 0, 0, time.UTC))

	if len(reports) != 1 {
		t.Fatalf("len(reports) = %d, want 1", len(reports))
	}
	if len(reports[0].Names) != maxDockerContainerNames {
		t.Fatalf("len(Names) = %d, want %d", len(reports[0].Names), maxDockerContainerNames)
	}
	for _, name := range reports[0].Names {
		if len(name) > maxDockerContainerNameBytes || !utf8.ValidString(name) {
			t.Fatalf("name length/UTF-8 invalid: len=%d valid=%v", len(name), utf8.ValidString(name))
		}
	}
	if len(reports[0].Labels) != maxDockerContainerLabels {
		t.Fatalf("len(Labels) = %d, want %d", len(reports[0].Labels), maxDockerContainerLabels)
	}
	for key, value := range reports[0].Labels {
		if len(key) > maxDockerContainerLabelKeyBytes || len(value) > maxDockerContainerLabelValueBytes {
			t.Fatalf("label exceeded bounds: key=%d value=%d", len(key), len(value))
		}
	}
}

func TestDockerContainerInventoryReportsFromProtoClampsFutureObservation(t *testing.T) {
	t.Parallel()

	receivedAt := time.Date(2026, 5, 13, 9, 30, 0, 0, time.UTC)
	reports := DockerContainerInventoryReportsFromProto([]*agentv1.DockerContainerInventory{{
		DockerContainerId: "container-1",
		ObservedAtUnix:    receivedAt.Add(time.Hour).Unix(),
		StartedAtUnix:     receivedAt.Add(time.Hour).Unix(),
	}}, receivedAt)

	if len(reports) != 1 {
		t.Fatalf("len(reports) = %d, want 1", len(reports))
	}
	if !reports[0].ObservedAt.Equal(receivedAt) {
		t.Fatalf("ObservedAt = %s, want receivedAt %s", reports[0].ObservedAt, receivedAt)
	}
	if reports[0].StartedAtSource != nil {
		t.Fatalf("StartedAtSource = %v, want nil for far-future source timestamp", reports[0].StartedAtSource)
	}
}
