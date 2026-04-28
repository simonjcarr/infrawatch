package ingestgrpc

import (
	"context"
	"log/slog"
	"runtime/debug"
	"time"

	"github.com/carrtech-dev/ct-ops/ingest/internal/monitoring"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

// MonitoringUnaryInterceptor records active unary requests and request message totals.
func MonitoringUnaryInterceptor(rec *monitoring.Recorder) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if rec == nil {
			return handler(ctx, req)
		}
		rec.RecordMessageReceived()
		done := rec.BeginRequest()
		defer done()
		return handler(ctx, req)
	}
}

// LoggingUnaryInterceptor logs unary RPC calls with timing.
func LoggingUnaryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	elapsed := time.Since(start)

	code := codes.OK
	if err != nil {
		code = status.Code(err)
	}
	slog.Info("grpc unary", "method", info.FullMethod, "code", code, "duration_ms", elapsed.Milliseconds())
	return resp, err
}

// RecoveryUnaryInterceptor catches panics in unary handlers and returns an Internal error.
func RecoveryUnaryInterceptor(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in unary handler", "panic", r, "stack", string(debug.Stack()))
			err = status.Errorf(codes.Internal, "internal server error")
		}
	}()
	return handler(ctx, req)
}

type monitoredServerStream struct {
	grpc.ServerStream
	rec *monitoring.Recorder
}

func (s *monitoredServerStream) RecvMsg(m interface{}) error {
	err := s.ServerStream.RecvMsg(m)
	if err == nil {
		s.rec.RecordMessageReceived()
	}
	return err
}

// MonitoringStreamInterceptor records active streams and every received stream message.
func MonitoringStreamInterceptor(rec *monitoring.Recorder) grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if rec == nil {
			return handler(srv, ss)
		}
		done := rec.BeginRequest()
		defer done()
		return handler(srv, &monitoredServerStream{ServerStream: ss, rec: rec})
	}
}

// LoggingStreamInterceptor logs streaming RPC setup.
func LoggingStreamInterceptor(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	p, _ := peer.FromContext(ss.Context())
	addr := "<unknown>"
	if p != nil {
		addr = p.Addr.String()
	}
	slog.Info("grpc stream opened", "method", info.FullMethod, "peer", addr)
	err := handler(srv, ss)
	if err != nil {
		slog.Warn("grpc stream closed with error", "method", info.FullMethod, "err", err)
	} else {
		slog.Info("grpc stream closed", "method", info.FullMethod)
	}
	return err
}

// RecoveryStreamInterceptor catches panics in stream handlers.
func RecoveryStreamInterceptor(srv interface{}, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) (err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in stream handler", "panic", r, "stack", string(debug.Stack()))
			err = status.Errorf(codes.Internal, "internal server error")
		}
	}()
	return handler(srv, ss)
}
