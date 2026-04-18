package queries

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HostCollision describes an existing host whose identity (hostname or IP) overlaps
// with a newly registering agent. Used to reject online duplicates and adopt offline
// ones rather than creating a second row for the same physical machine.
type HostCollision struct {
	HostID      string
	AgentID     string
	Hostname    string
	HostStatus  string // hosts.status: online | offline | unknown
	AgentStatus string // agents.status: pending | active | offline | revoked
}

// FindHostCollision looks for a non-deleted host in the given org whose hostname
// matches or whose ip_addresses jsonb array overlaps any of the provided ips.
// Returns nil, nil when no collision exists.
//
// An "online" match means the physical machine is still heartbeating under a
// different keypair — the new registration must be rejected. An "offline" or
// "unknown" match is treated as a re-registration of the same machine and the
// caller will rotate the keypair onto the existing row.
func FindHostCollision(ctx context.Context, pool *pgxpool.Pool, orgID, hostname string, ips []string) (*HostCollision, error) {
	const q = `
		SELECT h.id, COALESCE(h.agent_id, ''), h.hostname, h.status, COALESCE(a.status, '')
		FROM hosts h
		LEFT JOIN agents a ON a.id = h.agent_id
		WHERE h.organisation_id = $1
		  AND h.deleted_at IS NULL
		  AND (
		    h.hostname = $2
		    OR (cardinality($3::text[]) > 0 AND h.ip_addresses ?| $3::text[])
		  )
		ORDER BY
		  CASE WHEN h.status = 'online' THEN 0 ELSE 1 END,
		  h.last_seen_at DESC NULLS LAST
		LIMIT 1
	`
	if ips == nil {
		ips = []string{}
	}
	row := pool.QueryRow(ctx, q, orgID, hostname, ips)
	var c HostCollision
	if err := row.Scan(&c.HostID, &c.AgentID, &c.Hostname, &c.HostStatus, &c.AgentStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

// RotateAgentPublicKey replaces the public key on an existing agent row. Used
// during re-registration adoption: the physical machine is the same (hostname
// or IP match) but the agent has generated a fresh keypair (e.g. data dir wiped).
func RotateAgentPublicKey(ctx context.Context, pool *pgxpool.Pool, agentID, publicKey string) error {
	const q = `UPDATE agents SET public_key = $1, updated_at = NOW() WHERE id = $2`
	_, err := pool.Exec(ctx, q, publicKey, agentID)
	return err
}

// ReattachHostToAgent ensures a host row is linked to the given agent id. Used
// when adopting an existing host during re-registration.
func ReattachHostToAgent(ctx context.Context, pool *pgxpool.Pool, hostID, agentID, hostname string) error {
	const q = `
		UPDATE hosts
		SET agent_id   = $2,
		    hostname   = $3,
		    updated_at = NOW()
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, hostID, agentID, hostname)
	return err
}

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
