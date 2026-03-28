FROM golang:1.23-alpine AS builder

WORKDIR /build

# Copy Go workspace files
COPY go.work go.work.sum* ./
COPY proto/gen/go/ proto/gen/go/
COPY agent/go.mod agent/go.mod
COPY apps/ingest/ apps/ingest/

# Download dependencies
RUN go work sync && go mod download -modfile=apps/ingest/go.mod

# Build
RUN go build -o /dist/ingest ./apps/ingest/cmd/ingest

FROM alpine:3.20

RUN apk add --no-cache ca-certificates wget

COPY --from=builder /dist/ingest /usr/local/bin/ingest

# Create runtime directories
RUN mkdir -p /etc/infrawatch/tls /var/lib/infrawatch

EXPOSE 9443 8080

ENTRYPOINT ["ingest"]
CMD ["-config", "/etc/infrawatch/ingest.yaml"]
