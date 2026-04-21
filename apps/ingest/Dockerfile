FROM golang:1.26-alpine AS builder

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

FROM alpine:3.23

RUN apk add --no-cache ca-certificates wget && \
    addgroup --system --gid 1001 ingest && \
    adduser --system --uid 1001 --ingroup ingest ingest

COPY --from=builder /dist/ingest /usr/local/bin/ingest

# Create runtime directories. /var/lib/infrawatch must be writable so the
# ingest process can generate a JWT signing key on first boot.
RUN mkdir -p /etc/infrawatch/tls /var/lib/infrawatch && \
    chown -R ingest:ingest /etc/infrawatch /var/lib/infrawatch

# Bake the release-please manifest into the image. Both the web and ingest
# images are built from the same commit, so they always agree on the
# required agent version. Production users running from GHCR have no source
# checkout to bind-mount.
COPY --chown=ingest:ingest .release-please-manifest.json /etc/infrawatch/release-please-manifest.json

ENV INGEST_RELEASE_MANIFEST_PATH=/etc/infrawatch/release-please-manifest.json

USER ingest

EXPOSE 9443 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/healthz || exit 1

ENTRYPOINT ["ingest"]
CMD ["-config", "/etc/infrawatch/ingest.yaml"]
