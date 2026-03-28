package agentv1

// JSON codec is registered here so both agent and ingest use JSON serialization
// over gRPC without requiring protobuf encoding. This stub is replaced by proper
// protoc-generated encoding when `make proto` is run.

import (
	"encoding/json"

	"google.golang.org/grpc/encoding"
)

func init() {
	encoding.RegisterCodec(jsonCodec{})
}

type jsonCodec struct{}

func (jsonCodec) Marshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func (jsonCodec) Unmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

// Name returns "proto" to override the default gRPC proto codec.
func (jsonCodec) Name() string { return "proto" }
