# trivy:ignore:DS-0002
# This image intentionally runs systemd as PID 1 and validates the root-only
# CT-Ops agent installer path inside an isolated local development container.
FROM ubuntu:24.04

ENV container=docker

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    sudo \
    systemd \
    systemd-sysv \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

STOPSIGNAL SIGRTMIN+3

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD systemctl is-system-running --quiet || exit 1

CMD ["/sbin/init"]
