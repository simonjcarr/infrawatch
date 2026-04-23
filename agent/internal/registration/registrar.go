package registration

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"runtime"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"

	"github.com/carrtech-dev/ct-ops/agent/internal/identity"
)

const pollInterval = 30 * time.Second

// Registrar handles the agent registration lifecycle.
type Registrar struct {
	client   agentv1.IngestServiceClient
	keypair  *identity.Keypair
	orgToken string
	version  string
	tags     []*agentv1.Tag
	dataDir  string

	// Optional overrides. When hostnameOverride is non-empty it replaces
	// os.Hostname(). When ipsOverride is non-nil it replaces localIPs() —
	// passing an empty (but non-nil) slice intentionally sends no IP
	// addresses, which the load tester uses to avoid IP-collision adoption
	// on the server when many virtual agents share a single host IP.
	hostnameOverride string
	ipsOverride      *[]string
}

// New creates a new Registrar. Tags are applied at registration; merged order
// (config → CLI) is resolved by the caller. dataDir is where the agent
// persists any client cert / CA bundle it receives from the server.
func New(client agentv1.IngestServiceClient, keypair *identity.Keypair, orgToken, version string, tags []*agentv1.Tag, dataDir string) *Registrar {
	return &Registrar{
		client:   client,
		keypair:  keypair,
		orgToken: orgToken,
		version:  version,
		tags:     tags,
		dataDir:  dataDir,
	}
}

// SetHostnameOverride forces the registration payload's hostname to the given
// value instead of the OS-reported hostname. Used by the load tester to give
// each virtual agent a unique hostname.
func (r *Registrar) SetHostnameOverride(hostname string) {
	r.hostnameOverride = hostname
}

// SetIPAddressesOverride replaces the OS-discovered IP address list with the
// provided slice. Pass an empty slice to register with no IP addresses — the
// server's IP-collision check is skipped when the list is empty.
func (r *Registrar) SetIPAddressesOverride(ips []string) {
	r.ipsOverride = &ips
}

// Register calls the ingest service Register RPC.
// If the response status is "pending", it polls until the agent becomes
// "active" or the context is cancelled.
// Returns the final agent state once active.
func (r *Registrar) Register(ctx context.Context, existingAgentID string) (*identity.AgentState, error) {
	hostname := r.hostnameOverride
	if hostname == "" {
		h, err := os.Hostname()
		if err != nil {
			hostname = "unknown"
		} else {
			hostname = h
		}
	}

	var ips []string
	if r.ipsOverride != nil {
		ips = *r.ipsOverride
	} else {
		ips = localIPs()
	}

	csrDER, err := r.keypair.BuildCSR()
	if err != nil {
		return nil, fmt.Errorf("building CSR: %w", err)
	}

	req := &agentv1.RegisterRequest{
		OrgToken:  r.orgToken,
		PublicKey: r.keypair.PublicKeyPEM,
		CsrDer:    csrDER,
		PlatformInfo: &agentv1.PlatformInfo{
			Os:          runtime.GOOS,
			Arch:        runtime.GOARCH,
			IpAddresses: ips,
		},
		AgentInfo: &agentv1.AgentInfo{
			AgentId:  existingAgentID,
			Version:  r.version,
			Hostname: hostname,
		},
		Tags: r.tags,
	}

	for {
		resp, err := r.client.Register(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("register RPC: %w", err)
		}

		slog.Info("registration response", "status", resp.Status, "agent_id", resp.AgentId, "message", resp.Message)

		switch resp.Status {
		case "active":
			// Persist the signed client cert + CA bundle if the server supplied
			// them. Auto-approve sends them inline; manual approval delivers
			// them on a subsequent Register call once the sweeper has signed.
			if resp.ClientCertPem != "" {
				if err := identity.SaveClientCert(r.dataDir, []byte(resp.ClientCertPem)); err != nil {
					slog.Warn("saving client cert from Register response", "err", err)
				} else {
					slog.Info("persisted client cert from Register response")
				}
			}
			if resp.AgentCaCertPem != "" {
				_ = identity.SaveAgentCA(r.dataDir, []byte(resp.AgentCaCertPem))
			}
			return &identity.AgentState{
				AgentID:  resp.AgentId,
				JWTToken: resp.JwtToken,
			}, nil

		case "pending":
			slog.Info("agent pending approval, polling", "interval", pollInterval)
			// Update agent_id in subsequent requests (idempotent re-registration)
			req.AgentInfo.AgentId = resp.AgentId
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(pollInterval):
				// continue loop
			}

		case "revoked":
			return nil, fmt.Errorf("agent has been revoked: %s", resp.Message)

		default:
			return nil, fmt.Errorf("unexpected registration status %q: %s", resp.Status, resp.Message)
		}
	}
}

// localIPs returns the non-loopback IP addresses currently bound on this host,
// so the server can detect duplicate-host registrations by IP overlap.
// Mirrors the filtering used by the heartbeat's network interface reporter.
func localIPs() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var ips []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ip, _, err := net.ParseCIDR(addr.String())
			if err != nil {
				continue
			}
			ips = append(ips, ip.String())
		}
	}
	return ips
}
