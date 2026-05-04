package handlers

import (
	"testing"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
)

func TestClassifyHostCollisionCreatesFreshPendingRegistrationForOfflineExistingAgent(t *testing.T) {
	t.Parallel()

	collision := &queries.HostCollision{
		HostID:      "host_123",
		AgentID:     "agent_123",
		Hostname:    "db-01",
		HostStatus:  "offline",
		AgentStatus: "pending",
	}

	action := classifyHostCollision(collision)
	if action != collisionActionFreshInsert {
		t.Fatalf("classifyHostCollision() = %v, want %v", action, collisionActionFreshInsert)
	}
}

func TestClassifyHostCollisionRejectsOnlineExistingAgent(t *testing.T) {
	t.Parallel()

	collision := &queries.HostCollision{
		HostID:      "host_123",
		AgentID:     "agent_123",
		Hostname:    "db-01",
		HostStatus:  "online",
		AgentStatus: "active",
	}

	action := classifyHostCollision(collision)
	if action != collisionActionReject {
		t.Fatalf("classifyHostCollision() = %v, want %v", action, collisionActionReject)
	}
}

func TestClassifyHostCollisionAllowsUnlinkedHostInsert(t *testing.T) {
	t.Parallel()

	collision := &queries.HostCollision{
		HostID:     "host_123",
		Hostname:   "db-01",
		HostStatus: "unknown",
	}

	action := classifyHostCollision(collision)
	if action != collisionActionFreshInsert {
		t.Fatalf("classifyHostCollision() = %v, want %v", action, collisionActionFreshInsert)
	}
}
