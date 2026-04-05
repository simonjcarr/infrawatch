package queries

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertHost inserts a new host row linked to an agent and returns the host ID.
// Caller should verify no host exists for this agentID before calling.
func InsertHost(ctx context.Context, pool *pgxpool.Pool, orgID, agentID, hostname string) (string, error) {
	const q = `
		INSERT INTO hosts (id, organisation_id, agent_id, hostname, status)
		VALUES ($1, $2, $3, $4, 'unknown')
		RETURNING id
	`
	id := newCUID()
	var returnedID string
	err := pool.QueryRow(ctx, q, id, orgID, agentID, hostname).Scan(&returnedID)
	return returnedID, err
}

// GetHostByAgentID retrieves the host ID for a given agent, if one exists.
func GetHostByAgentID(ctx context.Context, pool *pgxpool.Pool, agentID string) (string, error) {
	const q = `SELECT id FROM hosts WHERE agent_id = $1 AND deleted_at IS NULL LIMIT 1`
	var id string
	err := pool.QueryRow(ctx, q, agentID).Scan(&id)
	return id, err
}

// UpdateHostVitals overwrites the latest vitals on the host row for a given agent.
func UpdateHostVitals(ctx context.Context, pool *pgxpool.Pool, agentID string, cpu, mem, disk float32, uptime int64, ipAddresses []string, osVersion, disksJSON, netJSON string) error {
	const q = `
		UPDATE hosts
		SET cpu_percent    = $2,
		    memory_percent = $3,
		    disk_percent   = $4,
		    uptime_seconds = $5,
		    ip_addresses   = $6::jsonb,
		    os_version     = COALESCE(NULLIF($7, ''), os_version),
		    metadata       = jsonb_build_object(
		                       'disks',              $8::jsonb,
		                       'network_interfaces', $9::jsonb
		                     ),
		    status         = 'online',
		    last_seen_at   = NOW(),
		    updated_at     = NOW()
		WHERE agent_id = $1 AND deleted_at IS NULL
	`
	ipJSON := buildIPJSON(ipAddresses)
	_, err := pool.Exec(ctx, q, agentID, cpu, mem, disk, uptime, ipJSON, osVersion, disksJSON, netJSON)
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

// newCUID generates a simple random ID compatible with the cuid2 format used by the web app.
// In production this would use the @paralleldrive/cuid2 equivalent or a UUID.
func newCUID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	b := make([]byte, 24)
	for i := range b {
		b[i] = chars[r.Intn(len(chars))]
	}
	return string(b)
}
