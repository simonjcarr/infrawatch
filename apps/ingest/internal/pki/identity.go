package pki

import "context"

// Identity is the SPIFFE-derived wire identity of the agent on the current
// RPC, populated by the mTLS gRPC interceptor after chain verification.
type Identity struct {
	OrgID   string
	AgentID string
	Serial  string
}

type identityCtxKey struct{}

// WithIdentity stashes id on the returned context.
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	return context.WithValue(ctx, identityCtxKey{}, id)
}

// IdentityFromContext returns the mTLS-verified identity for the current RPC.
// Returns (nil, false) for unauthenticated streams (Register only).
func IdentityFromContext(ctx context.Context) (*Identity, bool) {
	v, ok := ctx.Value(identityCtxKey{}).(*Identity)
	return v, ok
}
