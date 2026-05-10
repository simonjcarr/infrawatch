package handlers

import (
	"context"
	"errors"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/ingest/internal/auth"
	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
	"github.com/carrtech-dev/ct-ops/ingest/internal/pki"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

// RegisterHandler implements the Register RPC.
type RegisterHandler struct {
	pool                *pgxpool.Pool
	issuer              *auth.JWTIssuer
	ca                  *pki.AgentCA
	registrationLimiter *RegistrationLimiter
}

// NewRegisterHandler creates a RegisterHandler.
func NewRegisterHandler(pool *pgxpool.Pool, issuer *auth.JWTIssuer, ca *pki.AgentCA) *RegisterHandler {
	return &RegisterHandler{pool: pool, issuer: issuer, ca: ca, registrationLimiter: NewDefaultRegistrationLimiter()}
}

type hostCollisionDecision int

const (
	hostCollisionNone hostCollisionDecision = iota
	hostCollisionReject
	hostCollisionCreateSeparatePending
)

func decideHostCollision(collision *queries.HostCollision) (hostCollisionDecision, string) {
	if collision == nil || collision.AgentID == "" {
		return hostCollisionNone, ""
	}
	if collision.AgentStatus == "revoked" {
		return hostCollisionReject, "existing agent revoked"
	}
	if collision.HostStatus == "online" || collision.AgentStatus == "active" {
		return hostCollisionReject, "online duplicate"
	}
	return hostCollisionCreateSeparatePending, "existing offline or unknown host identity"
}

func existingAgentBelongsToTokenInstance(existing *queries.AgentRow, tokenInstanceID string) bool {
	return existing != nil && existing.InstanceID == tokenInstanceID
}

// Register handles agent registration.
//
// Flow:
//  1. Validate enrolment_token → UNAUTHENTICATED if invalid/expired
//  2. Check if public_key already registered → return existing state (idempotent)
//  3. Check for a colliding host (same hostname or overlapping IP) in the instance:
//     - Online match → reject with ALREADY_EXISTS (two live hosts can't share identity)
//     - Offline/unknown linked match → create a separate pending registration
//  4. Insert agent (status=pending) + host row
//  5. If auto_approve on token → set active, issue JWT
//  6. Return RegisterResponse
func (h *RegisterHandler) Register(ctx context.Context, req *agentv1.RegisterRequest) (*agentv1.RegisterResponse, error) {
	if req.EnrolmentToken == "" || req.PublicKey == "" {
		return nil, status.Error(codes.InvalidArgument, "enrolment_token and public_key are required")
	}
	if err := h.registrationLimiter.Allow(ctx, req.EnrolmentToken); err != nil {
		slog.Warn("throttling agent registration attempt", "err", err)
		return nil, err
	}

	hostname := "unknown"
	if req.AgentInfo != nil && req.AgentInfo.Hostname != "" {
		hostname = req.AgentInfo.Hostname
	}

	var reportedIPs []string
	if req.PlatformInfo != nil {
		reportedIPs = req.PlatformInfo.IpAddresses
	}

	// Step 1: Validate enrolment token
	token, err := queries.GetEnrolmentToken(ctx, h.pool, req.EnrolmentToken)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, status.Error(codes.Unauthenticated, "invalid or expired enrolment token")
		}
		slog.Error("looking up enrolment token", "err", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	instanceID := token.InstanceID

	// Step 2: Check for existing registration (idempotent)
	existing, err := queries.GetAgentByPublicKey(ctx, h.pool, req.PublicKey)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.Error("looking up agent by public key", "err", err)
		return nil, status.Error(codes.Internal, "internal error")
	}

	if existing != nil {
		if !existingAgentBelongsToTokenInstance(existing, instanceID) {
			slog.Warn("rejecting registration for existing public key in different instance",
				"agent_id", existing.ID,
				"agent_instance_id", existing.InstanceID,
				"token_instance_id", instanceID,
			)
			return nil, status.Error(codes.Unauthenticated, "invalid or expired enrolment token")
		}
		slog.Info("agent already registered", "agent_id", existing.ID, "status", existing.Status)
		// Update the queued CSR in case the agent has re-generated one (e.g.
		// after a reinstall that preserved the keypair but lost the cert).
		if len(req.CsrDer) > 0 && existing.Status != "revoked" {
			if err := queries.UpsertPendingCSR(ctx, h.pool, existing.ID, req.CsrDer); err != nil {
				slog.Warn("upserting pending CSR on re-registration", "err", err)
			}
		}
		if existing.Status == "active" {
			jwtToken, err := h.issuer.IssueAgentToken(existing.ID)
			if err != nil {
				slog.Error("issuing JWT for existing agent", "err", err)
				return nil, status.Error(codes.Internal, "internal error")
			}
			resp := &agentv1.RegisterResponse{
				AgentId:  existing.ID,
				Status:   "active",
				Message:  "agent already registered and active",
				JwtToken: jwtToken,
			}
			attachCertIfReady(ctx, h.pool, h.ca, existing.ID, resp)
			return resp, nil
		}
		return &agentv1.RegisterResponse{
			AgentId: existing.ID,
			Status:  existing.Status,
			Message: "agent already registered, status: " + existing.Status,
		}, nil
	}

	var agentOS, agentArch string
	if req.PlatformInfo != nil {
		agentOS = req.PlatformInfo.Os
		agentArch = req.PlatformInfo.Arch
	}

	// Merge tags from the enrolment token metadata (bundle-baked) with tags
	// sent in the request (config + CLI, already merged agent-side). Request
	// tags win on conflicting keys because a CLI --tag is more specific to
	// this physical machine than what the operator baked into the bundle.
	reqTagPairs := make([]queries.TagPair, 0, len(req.Tags))
	for _, t := range req.Tags {
		if t == nil || t.Key == "" || t.Value == "" {
			continue
		}
		reqTagPairs = append(reqTagPairs, queries.TagPair{Key: t.Key, Value: t.Value})
	}
	mergedTags := queries.MergeTagLayers(token.Metadata.Tags, reqTagPairs)

	// Step 3: Check for identity collision with an existing host in the instance.
	// Hostname or IP overlap is not sufficient proof that this is the same
	// physical machine. Existing live identities are rejected; offline/unknown
	// linked matches become separate pending registrations so an administrator
	// can review the claim without mutating the existing agent's key material.
	var collisionRequiringManualApproval *queries.HostCollision
	collision, err := queries.FindHostCollision(ctx, h.pool, instanceID, hostname, reportedIPs)
	if err != nil {
		slog.Error("checking host collision", "err", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	if collision != nil {
		decision, reason := decideHostCollision(collision)
		switch decision {
		case hostCollisionReject:
			slog.Warn("rejecting registration due to host collision",
				"hostname", hostname,
				"existing_host_id", collision.HostID,
				"existing_agent_id", collision.AgentID,
				"existing_host_status", collision.HostStatus,
				"existing_agent_status", collision.AgentStatus,
				"reason", reason,
			)
			return nil, status.Errorf(codes.AlreadyExists,
				"a host matching this hostname or IP is already registered in this instance (%s) — delete the existing host before re-registering",
				reason,
			)
		case hostCollisionCreateSeparatePending:
			collisionRequiringManualApproval = collision
			slog.Warn("creating separate pending registration for host collision",
				"hostname", hostname,
				"existing_host_id", collision.HostID,
				"existing_agent_id", collision.AgentID,
				"existing_host_status", collision.HostStatus,
				"existing_agent_status", collision.AgentStatus,
				"reason", reason,
			)
		case hostCollisionNone:
			slog.Warn("host collision has no linked agent; falling through to fresh insert",
				"host_id", collision.HostID)
		}
	}

	// Step 4: Atomically consume one token use before creating the new agent.
	// Repeat registration with an existing public key returns above without
	// consuming another use.
	token, err = queries.ConsumeEnrolmentToken(ctx, h.pool, req.EnrolmentToken)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, status.Error(codes.Unauthenticated, "invalid or expired enrolment token")
		}
		slog.Error("consuming enrolment token", "err", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	instanceID = token.InstanceID

	// Step 5: Insert new agent
	agentStatus := "pending"
	agentID, err := queries.InsertAgent(ctx, h.pool, instanceID, hostname, req.PublicKey, agentStatus, token.ID, agentOS, agentArch)
	if err != nil {
		slog.Error("inserting agent", "err", err)
		return nil, status.Error(codes.Internal, "failed to register agent")
	}

	// Queue CSR for signing (the sweeper only signs CSRs for active agents,
	// so pending registrations sit until admin approval).
	if len(req.CsrDer) > 0 {
		if err := queries.UpsertPendingCSR(ctx, h.pool, agentID, req.CsrDer); err != nil {
			slog.Warn("queueing CSR", "agent_id", agentID, "err", err)
		}
	}

	// Insert host row. When the token is NOT auto-approve, stash the merged
	// tags into metadata.pendingTags so approveAgent (TS) can drain them. On
	// auto-approve we apply tags directly below and pass nil here.
	var pendingForInsert []queries.TagPair
	if !token.AutoApprove || collisionRequiringManualApproval != nil {
		pendingForInsert = mergedTags
	}
	hostID, err := queries.InsertHost(ctx, h.pool, instanceID, agentID, hostname, agentOS, agentArch, pendingForInsert)
	if err != nil {
		slog.Warn("inserting host row", "err", err)
	}

	// Append status history
	statusReason := "initial registration"
	if collisionRequiringManualApproval != nil {
		statusReason = "registration matched an existing host identity; requires explicit admin review before merge or rebind"
	}
	if err := queries.InsertAgentStatusHistory(ctx, h.pool, agentID, instanceID, "pending", nil, statusReason); err != nil {
		slog.Warn("inserting status history", "err", err)
	}

	slog.Info("agent registered", "agent_id", agentID, "hostname", hostname, "auto_approve", token.AutoApprove)

	// Step 6: Auto-approve if configured
	if token.AutoApprove && collisionRequiringManualApproval == nil {
		if err := queries.ApproveAgent(ctx, h.pool, agentID); err != nil {
			slog.Error("auto-approving agent", "err", err)
			return nil, status.Error(codes.Internal, "internal error")
		}
		if err := queries.InsertAgentStatusHistory(ctx, h.pool, agentID, instanceID, "active", nil, "auto-approved by enrolment token"); err != nil {
			slog.Warn("inserting auto-approve history", "err", err)
		}

		// Apply merged tag layers (instance defaults → token → request) to the host
		// row. There is no TS approval step in the auto-approve path, so tags
		// must be written here. Saved tag_rules are evaluated later in TS by
		// a cron/backfill job since they may depend on non-registration state.
		if hostID != "" {
			defaults, err := queries.GetOrgDefaultTags(ctx, h.pool, instanceID)
			if err != nil {
				slog.Warn("loading instance default tags", "err", err)
			}
			finalTags := queries.MergeTagLayers(defaults, mergedTags)
			if len(finalTags) > 0 {
				if err := queries.AssignTagsToResource(ctx, h.pool, instanceID, "host", hostID, finalTags); err != nil {
					slog.Warn("applying tags on auto-approve", "err", err)
				}
			}
		}

		jwtToken, err := h.issuer.IssueAgentToken(agentID)
		if err != nil {
			slog.Error("issuing JWT for auto-approved agent", "err", err)
			return nil, status.Error(codes.Internal, "internal error")
		}

		// Sign the CSR inline so auto-approved agents receive their client
		// cert in the Register response and can mTLS from their very next
		// call. If anything fails we log and fall back to the async sweeper
		// path — the agent can retry Register once and pick up its cert.
		resp := &agentv1.RegisterResponse{
			AgentId:  agentID,
			Status:   "active",
			Message:  "agent registered and auto-approved",
			JwtToken: jwtToken,
		}
		if len(req.CsrDer) > 0 && h.ca != nil {
			if err := signAndAttach(ctx, h.pool, h.ca, agentID, req.CsrDer, resp); err != nil {
				slog.Warn("inline signing CSR on auto-approve", "err", err)
			}
		}
		slog.Info("agent auto-approved", "agent_id", agentID)
		return resp, nil
	}

	// Step 7: Pending — waiting for admin approval
	message := "agent registered and awaiting admin approval"
	if collisionRequiringManualApproval != nil {
		message = "agent registered as separate pending host because hostname or IP matches an existing host; admin review required"
	}
	return &agentv1.RegisterResponse{
		AgentId: agentID,
		Status:  "pending",
		Message: message,
	}, nil
}

// signAndAttach signs a CSR immediately, persists the leaf onto the agents
// row, clears any pending queue entry, and attaches the cert + CA to resp.
func signAndAttach(ctx context.Context, pool *pgxpool.Pool, ca *pki.AgentCA, agentID string, csrDER []byte, resp *agentv1.RegisterResponse) error {
	leaf, err := ca.Sign(csrDER, agentID)
	if err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `
		UPDATE agents
		   SET client_cert_pem = $1,
		       client_cert_serial = $2,
		       client_cert_issued_at = NOW(),
		       client_cert_not_after = $3,
		       updated_at = NOW()
		 WHERE id = $4`,
		string(leaf.PEM), leaf.Serial, leaf.NotAfter, agentID,
	); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `DELETE FROM pending_cert_signings WHERE agent_id = $1`, agentID); err != nil {
		slog.Warn("clearing pending CSR after inline sign", "agent_id", agentID, "err", err)
	}
	resp.ClientCertPem = string(leaf.PEM)
	resp.ClientCertNotAfterUnix = leaf.NotAfter.Unix()
	resp.AgentCaCertPem = string(ca.CertPEM)
	return nil
}

// attachCertIfReady populates client_cert_pem and agent_ca_cert_pem on resp
// from the agents row, if a cert has already been signed. Used for repeat
// Register calls from pending-then-approved agents.
func attachCertIfReady(ctx context.Context, pool *pgxpool.Pool, ca *pki.AgentCA, agentID string, resp *agentv1.RegisterResponse) {
	var certPEM string
	var notAfter *int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(client_cert_pem, ''),
		       CASE WHEN client_cert_not_after IS NULL
		            THEN NULL
		            ELSE EXTRACT(EPOCH FROM client_cert_not_after)::BIGINT END
		  FROM agents
		 WHERE id = $1`, agentID).Scan(&certPEM, &notAfter)
	if err != nil || certPEM == "" {
		return
	}
	resp.ClientCertPem = certPEM
	if ca != nil {
		resp.AgentCaCertPem = string(ca.CertPEM)
	}
	if notAfter != nil {
		resp.ClientCertNotAfterUnix = *notAfter
	}
}
