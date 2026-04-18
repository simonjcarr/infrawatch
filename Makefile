.PHONY: proto go-build go-test agent ingest loadtest clean

AGENT_DIST_DIR := apps/web/data/agent-dist

PROTO_OUT := proto/gen/go

# Persistent host-directory caches for Go builds.
# Using host dirs (owned by the current user) avoids permission errors when
# Docker runs with --user $(id -u):$(id -g) and a root-owned named volume.
GO_CACHE_DIR := $(HOME)/.cache/infrawatch/go-build
GO_MOD_DIR   := $(HOME)/.cache/infrawatch/go-mod

# Host platform — used to cross-compile the ingest binary for the machine
# running this Makefile (e.g. darwin/arm64 on Apple Silicon).
HOST_OS   := $(shell uname -s | tr '[:upper:]' '[:lower:]')
HOST_ARCH := $(shell uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

GO_CACHE_ARGS := \
	-e GOCACHE=/go-cache \
	-e GOPATH=/go-home \
	-v $(GO_CACHE_DIR):/go-cache \
	-v $(GO_MOD_DIR):/go-home

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
	@echo "Building agent binaries for all platforms..."
	@mkdir -p $(AGENT_DIST_DIR) $(GO_CACHE_DIR) $(GO_MOD_DIR)
	docker run --rm \
		-v "$(CURDIR):/src" \
		-w /src \
		--user "$(shell id -u):$(shell id -g)" \
		-e CGO_ENABLED=0 \
		$(GO_CACHE_ARGS) \
		golang:1.25 \
		sh -c 'for p in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do \
			os=$${p%%/*}; arch=$${p##*/}; \
			ext=""; [ "$$os" = "windows" ] && ext=".exe"; \
			echo "  $$os/$$arch..."; \
			GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags="-s -w" \
				-o $(AGENT_DIST_DIR)/infrawatch-agent-$$os-$$arch$$ext ./agent/cmd/agent; \
		done'
	@echo "Agent binaries ready in $(AGENT_DIST_DIR)/"

ingest:
	@echo "Building ingest service..."
	@mkdir -p dist $(GO_CACHE_DIR) $(GO_MOD_DIR)
	docker run --rm \
		-v "$(CURDIR):/src" \
		-w /src \
		--user "$(shell id -u):$(shell id -g)" \
		-e GOOS=$(HOST_OS) \
		-e GOARCH=$(HOST_ARCH) \
		$(GO_CACHE_ARGS) \
		golang:1.25 \
		go build -o dist/ingest ./apps/ingest/cmd/ingest
	@echo "Ingest binary: dist/ingest ($(HOST_OS)/$(HOST_ARCH))"

# Build the infrawatch-loadtest binary for the host platform only. This is a
# dev/ops tool for measuring sustainable fleet capacity of a given server
# profile; it is not shipped as a release artefact.
loadtest:
	@echo "Building infrawatch-loadtest for $(HOST_OS)/$(HOST_ARCH)..."
	@mkdir -p dist $(GO_CACHE_DIR) $(GO_MOD_DIR)
	docker run --rm \
		-v "$(CURDIR):/src" \
		-w /src \
		--user "$(shell id -u):$(shell id -g)" \
		-e GOOS=$(HOST_OS) \
		-e GOARCH=$(HOST_ARCH) \
		-e CGO_ENABLED=0 \
		$(GO_CACHE_ARGS) \
		golang:1.25 \
		go build -trimpath -ldflags="-s -w" -o dist/infrawatch-loadtest ./agent/cmd/loadtest
	@echo "Load-test binary: dist/infrawatch-loadtest ($(HOST_OS)/$(HOST_ARCH))"

go-test:
	@mkdir -p $(GO_CACHE_DIR) $(GO_MOD_DIR)
	docker run --rm \
		-v "$(CURDIR):/src" \
		-w /src \
		--user "$(shell id -u):$(shell id -g)" \
		$(GO_CACHE_ARGS) \
		golang:1.25 \
		go test ./agent/... ./apps/ingest/...

# Download all Go dependencies.
go-deps:
	@mkdir -p $(GO_CACHE_DIR) $(GO_MOD_DIR)
	docker run --rm \
		-v "$(CURDIR):/src" \
		-w /src \
		--user "$(shell id -u):$(shell id -g)" \
		$(GO_CACHE_ARGS) \
		golang:1.25 \
		sh -c "go work sync && cd proto/gen/go && go mod tidy && cd /src/agent && go mod tidy && cd /src/apps/ingest && go mod tidy"

# Generate dev TLS certificates for local development (requires Docker).
dev-tls:
	@mkdir -p deploy/dev-tls
	docker run --rm \
		-v "$(CURDIR)/deploy/dev-tls:/out" \
		alpine/openssl req -x509 \
		-newkey rsa:4096 \
		-keyout /out/server.key \
		-out /out/server.crt \
		-days 365 \
		-nodes \
		-subj "/CN=localhost" \
		-addext "subjectAltName=DNS:localhost,DNS:ingest,IP:127.0.0.1" \
		2>/dev/null
	@echo "Generated deploy/dev-tls/server.crt and deploy/dev-tls/server.key"

clean:
	rm -rf dist/ deploy/dev-tls/ deploy/dev-ingest-data/ $(AGENT_DIST_DIR)/

# Remove the persistent Go build/module cache directories.
clean-cache:
	rm -rf $(GO_CACHE_DIR) $(GO_MOD_DIR)
