package queries

import (
	"context"
	"net"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NetworkRow holds the ID and CIDR of a network definition.
type NetworkRow struct {
	ID   string
	CIDR string
}

// HostNetworkMembershipRow holds an existing membership record for a host.
type HostNetworkMembershipRow struct {
	ID           string
	NetworkID    string
	AutoAssigned bool
}

// GetNetworksForOrg returns all active (non-deleted) networks for an organisation.
func GetNetworksForOrg(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]NetworkRow, error) {
	const q = `
		SELECT id, cidr
		FROM networks
		WHERE organisation_id = $1
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []NetworkRow
	for rows.Next() {
		var n NetworkRow
		if err := rows.Scan(&n.ID, &n.CIDR); err != nil {
			return nil, err
		}
		result = append(result, n)
	}
	return result, rows.Err()
}

// GetHostNetworkMemberships returns all active (non-deleted) memberships for a host.
func GetHostNetworkMemberships(ctx context.Context, pool *pgxpool.Pool, hostID string) ([]HostNetworkMembershipRow, error) {
	const q = `
		SELECT id, network_id, auto_assigned
		FROM host_network_memberships
		WHERE host_id = $1
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []HostNetworkMembershipRow
	for rows.Next() {
		var m HostNetworkMembershipRow
		if err := rows.Scan(&m.ID, &m.NetworkID, &m.AutoAssigned); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

// UpsertHostNetworkMembership inserts a new auto-assigned membership or restores a
// soft-deleted one. The unique index on (network_id, host_id) drives the conflict.
func UpsertHostNetworkMembership(ctx context.Context, pool *pgxpool.Pool, orgID, networkID, hostID string) error {
	const q = `
		INSERT INTO host_network_memberships
		    (id, organisation_id, network_id, host_id, auto_assigned)
		VALUES ($1, $2, $3, $4, true)
		ON CONFLICT (network_id, host_id)
		DO UPDATE SET
		    auto_assigned = true,
		    deleted_at    = NULL,
		    updated_at    = NOW()
	`
	_, err := pool.Exec(ctx, q, newCUID(), orgID, networkID, hostID)
	return err
}

// RemoveAutoHostNetworkMembership soft-deletes a specific auto-assigned membership by
// its row ID. Manually assigned memberships (auto_assigned = false) are never removed.
func RemoveAutoHostNetworkMembership(ctx context.Context, pool *pgxpool.Pool, membershipID string) error {
	const q = `
		UPDATE host_network_memberships
		SET deleted_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1
		  AND auto_assigned = true
		  AND deleted_at IS NULL
	`
	_, err := pool.Exec(ctx, q, membershipID)
	return err
}

// SyncHostNetworks compares the host's current IP addresses against all network CIDR
// definitions for the organisation and keeps auto-assigned memberships in sync.
//
// Rules:
//   - If an IP falls within a network's CIDR and the host has no active membership,
//     one is created (auto_assigned = true).
//   - If an existing auto-assigned membership's network no longer matches any IP, the
//     membership is soft-deleted.
//   - Manually assigned memberships (auto_assigned = false) are never touched.
func SyncHostNetworks(ctx context.Context, pool *pgxpool.Pool, orgID, hostID string, hostIPs []string) error {
	// Parse all host IPs, stripping any prefix length notation (e.g. "192.168.1.5/24").
	var parsedIPs []net.IP
	for _, raw := range hostIPs {
		clean := raw
		if idx := strings.Index(raw, "/"); idx != -1 {
			clean = raw[:idx]
		}
		if ip := net.ParseIP(clean); ip != nil {
			parsedIPs = append(parsedIPs, ip)
		}
	}

	// Fetch all active networks for the org.
	networks, err := GetNetworksForOrg(ctx, pool, orgID)
	if err != nil {
		return err
	}

	// Determine which networks contain at least one of the host's IPs.
	matchingNetworkIDs := make(map[string]bool)
	for _, n := range networks {
		_, ipNet, err := net.ParseCIDR(n.CIDR)
		if err != nil {
			continue // skip malformed CIDRs
		}
		for _, ip := range parsedIPs {
			if ipNet.Contains(ip) {
				matchingNetworkIDs[n.ID] = true
				break
			}
		}
	}

	// Fetch current memberships for this host.
	memberships, err := GetHostNetworkMemberships(ctx, pool, hostID)
	if err != nil {
		return err
	}
	currentMemberships := make(map[string]HostNetworkMembershipRow)
	for _, m := range memberships {
		currentMemberships[m.NetworkID] = m
	}

	// Add missing auto-assigned memberships.
	for networkID := range matchingNetworkIDs {
		if _, exists := currentMemberships[networkID]; !exists {
			if err := UpsertHostNetworkMembership(ctx, pool, orgID, networkID, hostID); err != nil {
				return err
			}
		}
	}

	// Remove stale auto-assigned memberships.
	for networkID, membership := range currentMemberships {
		if membership.AutoAssigned && !matchingNetworkIDs[networkID] {
			if err := RemoveAutoHostNetworkMembership(ctx, pool, membership.ID); err != nil {
				return err
			}
		}
	}

	return nil
}
