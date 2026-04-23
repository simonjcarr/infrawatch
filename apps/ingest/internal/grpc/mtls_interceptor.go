package ingestgrpc

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/ingest/internal/pki"
)

// registerFullMethod is the gRPC method name of the single RPC that is
// allowed to run without a verified client cert. A brand-new agent hasn't
// been issued a cert yet, so it has to bootstrap through Register.
const registerFullMethod = "/agent.v1.IngestService/Register"

// NewMTLSUnaryInterceptor enforces: every RPC other than Register must
// present a verified client cert whose SPIFFE URI SAN parses. The identity
// is stashed on the context. Revocation has already been checked in the TLS
// layer's VerifyPeerCertificate callback.
func NewMTLSUnaryInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if info.FullMethod == registerFullMethod {
			return handler(ctx, req)
		}
		ctx, err := attachIdentity(ctx)
		if err != nil {
			return nil, err
		}
		return handler(ctx, req)
	}
}

// NewMTLSStreamInterceptor is the stream version of the above.
func NewMTLSStreamInterceptor() grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if info.FullMethod == registerFullMethod {
			return handler(srv, ss)
		}
		ctx, err := attachIdentity(ss.Context())
		if err != nil {
			return err
		}
		return handler(srv, &wrappedStream{ServerStream: ss, ctx: ctx})
	}
}

type wrappedStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (w *wrappedStream) Context() context.Context { return w.ctx }

func attachIdentity(ctx context.Context) (context.Context, error) {
	p, ok := peer.FromContext(ctx)
	if !ok || p == nil {
		return ctx, status.Error(codes.Unauthenticated, "no peer info")
	}
	tlsInfo, ok := p.AuthInfo.(credentials.TLSInfo)
	if !ok {
		return ctx, status.Error(codes.Unauthenticated, "peer is not TLS")
	}
	if len(tlsInfo.State.VerifiedChains) == 0 {
		return ctx, status.Error(codes.Unauthenticated, "client certificate required for this RPC")
	}
	orgID, agentID, err := pki.SpiffeURIFromCert(tlsInfo.State.VerifiedChains[0][0])
	if err != nil {
		return ctx, status.Errorf(codes.Unauthenticated, "client cert missing SPIFFE identity: %v", err)
	}
	serial := tlsInfo.State.VerifiedChains[0][0].SerialNumber.Text(16)
	return pki.WithIdentity(ctx, &pki.Identity{OrgID: orgID, AgentID: agentID, Serial: serial}), nil
}
