.PHONY: proto go-build go-test agent ingest clean

PROTO_OUT := proto/gen/go

# Generate Go code from .proto sources.
# Requires: protoc, protoc-gen-go, protoc-gen-go-grpc
# Install: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
#          go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
proto:
	@echo "Generating Go proto bindings..."
	protoc \
		--go_out=$(PROTO_OUT) --go_opt=paths=source_relative \
		--go-grpc_out=$(PROTO_OUT) --go-grpc_opt=paths=source_relative \
		-I proto \
		proto/agent/v1/*.proto
	@echo "Done. Generated files in $(PROTO_OUT)/agent/v1/"
	@echo "NOTE: Remove $(PROTO_OUT)/agent/v1/codec.go after running proto generation."

# Build agent and ingest binaries.
go-build: agent ingest

agent:
	@echo "Building agent..."
	mkdir -p dist
	go build -o dist/agent ./agent/cmd/agent

ingest:
	@echo "Building ingest service..."
	mkdir -p dist
	go build -o dist/ingest ./apps/ingest/cmd/ingest

go-test:
	go test ./agent/... ./apps/ingest/...

# Download all Go dependencies.
go-deps:
	go work sync
	cd proto/gen/go && go mod tidy
	cd agent && go mod tidy
	cd apps/ingest && go mod tidy

# Generate dev TLS certificates for local development.
dev-tls:
	bash deploy/scripts/gen-dev-tls.sh

clean:
	rm -rf dist/ deploy/dev-tls/
