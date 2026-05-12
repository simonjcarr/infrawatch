FROM python:3.13-alpine

RUN apk add --no-cache ansible openssh-client \
  && addgroup -S ansible \
  && adduser -S -G ansible ansible

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

USER ansible:ansible
CMD ["python", "/app/server.py"]
