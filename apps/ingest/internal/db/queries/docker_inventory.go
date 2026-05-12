package queries

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const (
	MaxDockerInventoryItemsPerBatch = 1000

	maxDockerInventoryFutureSkew      = 5 * time.Minute
	maxDockerContainerIDBytes         = 128
	maxDockerContainerNameBytes       = 256
	maxDockerContainerNames           = 16
	maxDockerContainerImageBytes      = 512
	maxDockerContainerImageIDBytes    = 512
	maxDockerContainerStateBytes      = 64
	maxDockerContainerStatusBytes     = 512
	maxDockerContainerLabelKeyBytes   = 256
	maxDockerContainerLabelValueBytes = 1024
	maxDockerContainerLabels          = 128
)

type DockerContainerInventoryReport struct {
	DockerContainerID string
	Names             []string
	PrimaryName       string
	Image             string
	ImageID           string
	Labels            map[string]string
	State             string
	Status            string
	CreatedAtSource   *time.Time
	StartedAtSource   *time.Time
	FinishedAtSource  *time.Time
	ObservedAt        time.Time
	RestartCount      int32
}

func DockerContainerInventoryReportsFromProto(items []*agentv1.DockerContainerInventory, receivedAt time.Time) []DockerContainerInventoryReport {
	reports := make([]DockerContainerInventoryReport, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		containerID := truncateUTF8(strings.TrimSpace(item.DockerContainerId), maxDockerContainerIDBytes)
		if containerID == "" {
			continue
		}

		names := normalizeDockerInventoryNames(item.Names)
		primaryName := ""
		if len(names) > 0 {
			primaryName = names[0]
		}
		reports = append(reports, DockerContainerInventoryReport{
			DockerContainerID: containerID,
			Names:             names,
			PrimaryName:       primaryName,
			Image:             truncateUTF8(strings.TrimSpace(item.Image), maxDockerContainerImageBytes),
			ImageID:           truncateUTF8(strings.TrimSpace(item.ImageId), maxDockerContainerImageIDBytes),
			Labels:            normalizeDockerInventoryLabels(item.Labels),
			State:             truncateUTF8(strings.TrimSpace(item.State), maxDockerContainerStateBytes),
			Status:            truncateUTF8(strings.TrimSpace(item.Status), maxDockerContainerStatusBytes),
			CreatedAtSource:   dockerInventorySourceTimePtr(item.CreatedAtUnix, receivedAt),
			StartedAtSource:   dockerInventorySourceTimePtr(item.StartedAtUnix, receivedAt),
			FinishedAtSource:  dockerInventorySourceTimePtr(item.FinishedAtUnix, receivedAt),
			ObservedAt:        dockerInventoryObservedAt(item.ObservedAtUnix, receivedAt),
			RestartCount:      item.RestartCount,
		})
	}
	return reports
}

func SyncDockerContainerInventory(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, reports []DockerContainerInventoryReport, inventoryAt time.Time, markMissing bool) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	seenIDs := make([]string, 0, len(reports))
	for _, report := range reports {
		if report.DockerContainerID == "" {
			continue
		}
		seenIDs = append(seenIDs, report.DockerContainerID)
		namesJSON, err := json.Marshal(report.Names)
		if err != nil {
			return err
		}
		labelsJSON, err := json.Marshal(report.Labels)
		if err != nil {
			return err
		}
		const upsert = `
			INSERT INTO docker_containers (
				id,
				instance_id,
				host_id,
				docker_container_id,
				primary_name,
				names_json,
				image,
				image_id,
				labels_json,
				state,
				status,
				created_at_source,
				started_at_source,
				finished_at_source,
				first_seen_at,
				last_seen_at,
				last_inventory_at,
				restart_count,
				is_present
			)
			VALUES (
				$1, $2, $3, $4, NULLIF($5, ''), $6::jsonb, NULLIF($7, ''), NULLIF($8, ''), $9::jsonb,
				NULLIF($10, ''), NULLIF($11, ''), $12, $13, $14, $15, $16, $17, $18, true
			)
			ON CONFLICT (host_id, docker_container_id) DO UPDATE
			SET instance_id       = EXCLUDED.instance_id,
			    primary_name      = EXCLUDED.primary_name,
			    names_json        = EXCLUDED.names_json,
			    image             = EXCLUDED.image,
			    image_id          = EXCLUDED.image_id,
			    labels_json       = EXCLUDED.labels_json,
			    state             = EXCLUDED.state,
			    status            = EXCLUDED.status,
			    created_at_source = COALESCE(EXCLUDED.created_at_source, docker_containers.created_at_source),
			    started_at_source = EXCLUDED.started_at_source,
			    finished_at_source = EXCLUDED.finished_at_source,
			    last_seen_at      = GREATEST(docker_containers.last_seen_at, EXCLUDED.last_seen_at),
			    last_inventory_at = EXCLUDED.last_inventory_at,
			    restart_count     = EXCLUDED.restart_count,
			    is_present        = true,
			    updated_at        = NOW()
		`
		if _, err := tx.Exec(ctx, upsert,
			newCUID(),
			instanceID,
			hostID,
			report.DockerContainerID,
			report.PrimaryName,
			string(namesJSON),
			report.Image,
			report.ImageID,
			string(labelsJSON),
			report.State,
			report.Status,
			report.CreatedAtSource,
			report.StartedAtSource,
			report.FinishedAtSource,
			report.ObservedAt,
			report.ObservedAt,
			inventoryAt,
			report.RestartCount,
		); err != nil {
			return err
		}
	}

	if markMissing {
		const markMissingQuery = `
			UPDATE docker_containers
			SET is_present = false,
			    last_inventory_at = $3,
			    updated_at = NOW()
			WHERE instance_id = $1
			  AND host_id = $2
			  AND is_present = true
			  AND NOT (docker_container_id = ANY($4::text[]))
		`
		if _, err := tx.Exec(ctx, markMissingQuery, instanceID, hostID, inventoryAt, seenIDs); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func normalizeDockerInventoryNames(names []string) []string {
	out := make([]string, 0, len(names))
	seen := make(map[string]struct{}, len(names))
	for _, name := range names {
		name = strings.TrimPrefix(strings.TrimSpace(name), "/")
		name = truncateUTF8(name, maxDockerContainerNameBytes)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
		if len(out) >= maxDockerContainerNames {
			break
		}
	}
	return out
}

func normalizeDockerInventoryLabels(labels []*agentv1.DockerContainerLabel) map[string]string {
	out := make(map[string]string, len(labels))
	for _, label := range labels {
		if label == nil {
			continue
		}
		key := truncateUTF8(strings.TrimSpace(label.Key), maxDockerContainerLabelKeyBytes)
		if key == "" {
			continue
		}
		out[key] = truncateUTF8(label.Value, maxDockerContainerLabelValueBytes)
		if len(out) >= maxDockerContainerLabels {
			break
		}
	}
	return out
}

func dockerInventoryObservedAt(value int64, receivedAt time.Time) time.Time {
	observedAt := receivedAt.UTC()
	if value > 0 {
		observedAt = time.Unix(value, 0).UTC()
	}
	if observedAt.After(receivedAt.Add(maxDockerInventoryFutureSkew)) {
		return receivedAt.UTC()
	}
	return observedAt
}

func dockerInventorySourceTimePtr(value int64, receivedAt time.Time) *time.Time {
	if value <= 0 {
		return nil
	}
	t := time.Unix(value, 0).UTC()
	if t.After(receivedAt.Add(maxDockerInventoryFutureSkew)) {
		return nil
	}
	return &t
}
