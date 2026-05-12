package queries

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const (
	MaxDockerStatusErrorBytes   = 512
	maxDockerStatusVersionBytes = 128
	maxDockerStatusFutureSkew   = 5 * time.Minute
)

type DockerStatusReport struct {
	Status         string
	CheckedAt      time.Time
	RuntimeVersion string
	APIVersion     string
	ErrorMessage   string
}

func DockerStatusReportFromProto(status *agentv1.DockerStatus, observedAt time.Time) (DockerStatusReport, bool) {
	if status == nil {
		return DockerStatusReport{}, false
	}

	report := DockerStatusReport{
		RuntimeVersion: truncateUTF8(strings.TrimSpace(status.RuntimeVersion), maxDockerStatusVersionBytes),
		APIVersion:     truncateUTF8(strings.TrimSpace(status.ApiVersion), maxDockerStatusVersionBytes),
		ErrorMessage:   truncateUTF8(strings.TrimSpace(status.ErrorMessage), MaxDockerStatusErrorBytes),
	}

	switch status.Status {
	case agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_NOT_INSTALLED:
		report.Status = "not_installed"
	case agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_INSTALLED:
		report.Status = "installed"
	case agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_PERMISSION_DENIED:
		report.Status = "permission_denied"
	case agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_UNREACHABLE:
		report.Status = "unreachable"
	case agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_ERROR:
		report.Status = "error"
	default:
		return DockerStatusReport{}, false
	}

	if status.CheckedAtUnix > 0 {
		report.CheckedAt = time.Unix(status.CheckedAtUnix, 0).UTC()
	} else {
		report.CheckedAt = observedAt.UTC()
	}
	if report.CheckedAt.After(observedAt.Add(maxDockerStatusFutureSkew)) {
		report.CheckedAt = observedAt.UTC()
	}

	if report.Status == "installed" {
		report.ErrorMessage = ""
	}

	return report, true
}

func UpsertHostDockerStatus(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, report DockerStatusReport) error {
	const q = `
		INSERT INTO host_docker_status (
			id,
			instance_id,
			host_id,
			status,
			checked_at,
			runtime_version,
			api_version,
			error_message
		)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''))
		ON CONFLICT (host_id) DO UPDATE
		SET instance_id      = EXCLUDED.instance_id,
		    status           = EXCLUDED.status,
		    checked_at       = EXCLUDED.checked_at,
		    runtime_version  = EXCLUDED.runtime_version,
		    api_version      = EXCLUDED.api_version,
		    error_message    = EXCLUDED.error_message,
		    updated_at       = NOW()
	`
	_, err := pool.Exec(ctx, q,
		newCUID(),
		instanceID,
		hostID,
		report.Status,
		report.CheckedAt,
		report.RuntimeVersion,
		report.APIVersion,
		report.ErrorMessage,
	)
	return err
}

func truncateUTF8(value string, maxBytes int) string {
	if maxBytes <= 0 || len(value) <= maxBytes {
		return value
	}
	truncated := value[:maxBytes]
	for !utf8.ValidString(truncated) && len(truncated) > 0 {
		truncated = truncated[:len(truncated)-1]
	}
	return truncated
}
