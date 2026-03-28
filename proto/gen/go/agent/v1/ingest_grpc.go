package agentv1

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// IngestServiceClient is the client API for IngestService.
type IngestServiceClient interface {
	Register(ctx context.Context, in *RegisterRequest, opts ...grpc.CallOption) (*RegisterResponse, error)
	Heartbeat(ctx context.Context, opts ...grpc.CallOption) (IngestService_HeartbeatClient, error)
}

type ingestServiceClient struct {
	cc grpc.ClientConnInterface
}

func NewIngestServiceClient(cc grpc.ClientConnInterface) IngestServiceClient {
	return &ingestServiceClient{cc}
}

func (c *ingestServiceClient) Register(ctx context.Context, in *RegisterRequest, opts ...grpc.CallOption) (*RegisterResponse, error) {
	out := new(RegisterResponse)
	err := c.cc.Invoke(ctx, "/agent.v1.IngestService/Register", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *ingestServiceClient) Heartbeat(ctx context.Context, opts ...grpc.CallOption) (IngestService_HeartbeatClient, error) {
	stream, err := c.cc.NewStream(ctx, &IngestService_ServiceDesc.Streams[0], "/agent.v1.IngestService/Heartbeat", opts...)
	if err != nil {
		return nil, err
	}
	x := &ingestServiceHeartbeatClient{stream}
	return x, nil
}

// IngestService_HeartbeatClient is the client-side stream for Heartbeat.
type IngestService_HeartbeatClient interface {
	Send(*HeartbeatRequest) error
	Recv() (*HeartbeatResponse, error)
	grpc.ClientStream
}

type ingestServiceHeartbeatClient struct {
	grpc.ClientStream
}

func (x *ingestServiceHeartbeatClient) Send(m *HeartbeatRequest) error {
	return x.ClientStream.SendMsg(m)
}

func (x *ingestServiceHeartbeatClient) Recv() (*HeartbeatResponse, error) {
	m := new(HeartbeatResponse)
	if err := x.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

// IngestServiceServer is the server API for IngestService.
type IngestServiceServer interface {
	Register(context.Context, *RegisterRequest) (*RegisterResponse, error)
	Heartbeat(IngestService_HeartbeatServer) error
	mustEmbedUnimplementedIngestServiceServer()
}

// UnimplementedIngestServiceServer must be embedded to have forward-compatible implementations.
type UnimplementedIngestServiceServer struct{}

func (UnimplementedIngestServiceServer) Register(context.Context, *RegisterRequest) (*RegisterResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Register not implemented")
}

func (UnimplementedIngestServiceServer) Heartbeat(IngestService_HeartbeatServer) error {
	return status.Errorf(codes.Unimplemented, "method Heartbeat not implemented")
}

func (UnimplementedIngestServiceServer) mustEmbedUnimplementedIngestServiceServer() {}

// UnsafeIngestServiceServer may be embedded to opt out of forward compatibility.
type UnsafeIngestServiceServer interface {
	mustEmbedUnimplementedIngestServiceServer()
}

// IngestService_HeartbeatServer is the server-side stream for Heartbeat.
type IngestService_HeartbeatServer interface {
	Send(*HeartbeatResponse) error
	Recv() (*HeartbeatRequest, error)
	grpc.ServerStream
}

type ingestServiceHeartbeatServer struct {
	grpc.ServerStream
}

func (x *ingestServiceHeartbeatServer) Send(m *HeartbeatResponse) error {
	return x.ServerStream.SendMsg(m)
}

func (x *ingestServiceHeartbeatServer) Recv() (*HeartbeatRequest, error) {
	m := new(HeartbeatRequest)
	if err := x.ServerStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

func RegisterIngestServiceServer(s grpc.ServiceRegistrar, srv IngestServiceServer) {
	s.RegisterService(&IngestService_ServiceDesc, srv)
}

func _IngestService_Register_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(RegisterRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(IngestServiceServer).Register(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/agent.v1.IngestService/Register",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(IngestServiceServer).Register(ctx, req.(*RegisterRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _IngestService_Heartbeat_Handler(srv interface{}, stream grpc.ServerStream) error {
	return srv.(IngestServiceServer).Heartbeat(&ingestServiceHeartbeatServer{stream})
}

// IngestService_ServiceDesc is the grpc.ServiceDesc for IngestService.
var IngestService_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "agent.v1.IngestService",
	HandlerType: (*IngestServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "Register",
			Handler:    _IngestService_Register_Handler,
		},
	},
	Streams: []grpc.StreamDesc{
		{
			StreamName:    "Heartbeat",
			Handler:       _IngestService_Heartbeat_Handler,
			ServerStreams: true,
			ClientStreams: true,
		},
	},
	Metadata: "agent/v1/ingest.proto",
}
