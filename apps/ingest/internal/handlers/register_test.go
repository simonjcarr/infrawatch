package handlers

import (
	"testing"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
)

func TestDecideHostCollisionCreatesSeparatePendingForOfflineLinkedHost(t *testing.T) {
	t.Parallel()

	decision, reason := decideHostCollision(&queries.HostCollision{
		HostID:      "host_existing",
		AgentID:     "agent_existing",
		Hostname:    "server-01",
		HostStatus:  "offline",
		AgentStatus: "offline",
	})

	if decision != hostCollisionCreateSeparatePending {
		t.Fatalf("decision = %v, want %v", decision, hostCollisionCreateSeparatePending)
	}
	if reason == "" {
		t.Fatal("reason is empty")
	}
}

func TestDecideHostCollisionRejectsOnlineOrActiveHost(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		collision queries.HostCollision
	}{
		{
			name: "online host",
			collision: queries.HostCollision{
				HostID:      "host_existing",
				AgentID:     "agent_existing",
				Hostname:    "server-01",
				HostStatus:  "online",
				AgentStatus: "offline",
			},
		},
		{
			name: "active agent",
			collision: queries.HostCollision{
				HostID:      "host_existing",
				AgentID:     "agent_existing",
				Hostname:    "server-01",
				HostStatus:  "offline",
				AgentStatus: "active",
			},
		},
		{
			name: "revoked agent",
			collision: queries.HostCollision{
				HostID:      "host_existing",
				AgentID:     "agent_existing",
				Hostname:    "server-01",
				HostStatus:  "offline",
				AgentStatus: "revoked",
			},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			decision, reason := decideHostCollision(&tt.collision)
			if decision != hostCollisionReject {
				t.Fatalf("decision = %v, want %v", decision, hostCollisionReject)
			}
			if reason == "" {
				t.Fatal("reason is empty")
			}
		})
	}
}

func TestExistingAgentBelongsToTokenOrgRejectsOrgMismatch(t *testing.T) {
	t.Parallel()

	existing := &queries.AgentRow{
		ID:             "agent_existing",
		OrganisationID: "org_original",
		Status:         "active",
	}

	if existingAgentBelongsToTokenOrg(existing, "org_attacker") {
		t.Fatal("existing agent matched a different enrolment token organisation")
	}
}
