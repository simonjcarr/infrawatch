FROM golang:1.23-alpine AS builder

WORKDIR /build

# Copy Go workspace files
COPY go.work go.work.sum* ./
COPY proto/gen/go/ proto/gen/go/
COPY agent/go.mod agent/go.mod
COPY apps/ingest/ apps/ingest/

# Download dependencies
RUN go work sync && go mod download

# Build
RUN go build -o /dist/ingest ./apps/ingest/cmd/ingest

FROM alpine:3.20

RUN apk add --no-cache ca-certificates wget

COPY --from=builder /dist/ingest /usr/local/bin/ingest

# Bake the release-please manifest into the image. Both the web and ingest
# images are built from the same commit, so they always agree on the
# required agent version. Production users running from GHCR have no source
# checkout to bind-mount.
COPY .release-please-manifest.json /etc/infrawatch/release-please-manifest.json

# Create runtime directories
RUN mkdir -p /etc/infrawatch/tls /var/lib/infrawatch

ENV INGEST_RELEASE_MANIFEST_PATH=/etc/infrawatch/release-please-manifest.json

EXPOSE 9443 8080

ENTRYPOINT ["ingest"]
CMD ["-config", "/etc/infrawatch/ingest.yaml"]
