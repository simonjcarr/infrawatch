package queries

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertHost inserts a new host row linked to an agent and returns the host ID.
// Caller should verify no host exists for this agentID before calling.
func InsertHost(ctx context.Context, pool *pgxpool.Pool, orgID, agentID, hostname, agentOS, agentArch string) (string, error) {
	const q = `
		INSERT INTO hosts (id, organisation_id, agent_id, hostname, os, arch, status)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), 'unknown')
		RETURNING id
	`
	id := newCUID()
	var returnedID string
	err := pool.QueryRow(ctx, q, id, orgID, agentID, hostname, agentOS, agentArch).Scan(&returnedID)
	return returnedID, err
}

// GetHostByAgentID retrieves the host ID for a given agent, if one exists.
func GetHostByAgentID(ctx context.Context, pool *pgxpool.Pool, agentID string) (string, error) {
	const q = `SELECT id FROM hosts WHERE agent_id = $1 AND deleted_at IS NULL LIMIT 1`
	var id string
	err := pool.QueryRow(ctx, q, agentID).Scan(&id)
	return id, err
}

// GetHostAgentStatus returns the agent status and agent_id for a given host ID.
// Used for terminal diagnostics to verify the heartbeat is active.
func GetHostAgentStatus(ctx context.Context, pool *pgxpool.Pool, hostID string) (agentID, agentStatus string, err error) {
	const q = `
		SELECT COALESCE(h.agent_id, ''), COALESCE(a.status, 'none')
		FROM hosts h
		LEFT JOIN agents a ON a.id = h.agent_id
		WHERE h.id = $1 AND h.deleted_at IS NULL
	`
	err = pool.QueryRow(ctx, q, hostID).Scan(&agentID, &agentStatus)
	return
}

// UpdateHostVitals overwrites the latest vitals on the host row for a given agent.
func UpdateHostVitals(ctx context.Context, pool *pgxpool.Pool, agentID string, cpu, mem, disk float32, uptime int64, ipAddresses []string, osVersion, agentOS, agentArch, disksJSON, netJSON string) error {
	const q = `
		UPDATE hosts
		SET cpu_percent    = $2,
		    memory_percent = $3,
		    disk_percent   = $4,
		    uptime_seconds = $5,
		    ip_addresses   = $6::jsonb,
		    os_version     = COALESCE(NULLIF($7, ''), os_version),
		    os             = COALESCE(NULLIF($8, ''), os),
		    arch           = COALESCE(NULLIF($9, ''), arch),
		    metadata       = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
		                       'disks',              $10::jsonb,
		                       'network_interfaces', $11::jsonb
		                     ),
		    status         = 'online',
		    last_seen_at   = NOW(),
		    updated_at     = NOW()
		WHERE agent_id = $1 AND deleted_at IS NULL
	`
	ipJSON := buildIPJSON(ipAddresses)
	_, err := pool.Exec(ctx, q, agentID, cpu, mem, disk, uptime, ipJSON, osVersion, agentOS, agentArch, disksJSON, netJSON)
	return err
}

// SetHostOffline marks the host associated with an agent as offline.
func SetHostOffline(ctx context.Context, pool *pgxpool.Pool, agentID string) error {
	const q = `
		UPDATE hosts
		SET status     = 'offline',
		    updated_at = NOW()
		WHERE agent_id = $1 AND deleted_at IS NULL
	`
	_, err := pool.Exec(ctx, q, agentID)
	return err
}

// MarshalToJSONString marshals v to a JSON string, returning "[]" on error.
func MarshalToJSONString(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func buildIPJSON(ips []string) string {
	if len(ips) == 0 {
		return "[]"
	}
	result := "["
	for i, ip := range ips {
		if i > 0 {
			result += ","
		}
		result += fmt.Sprintf("%q", ip)
	}
	result += "]"
	return result
}

// newCUID generates a cryptographically random ID compatible with the cuid2 format used by the web app.
func newCUID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	for i, b := range buf {
		buf[i] = chars[int(b)%len(chars)]
	}
	return string(buf)
}
