import { NextRequest, NextResponse } from 'next/server'

/**
 * Returns a shell install script that detects the host platform and downloads
 * the correct agent binary from this server.
 *
 * Usage on a target server:
 *   curl -fsSL https://infrawatch.example.com/api/agent/install | bash
 *
 * The script embeds the server base URL from the request so it always points
 * back to the same Infrawatch instance — no hardcoded URLs.
 */
export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? 'localhost'
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const serverURL = `${proto}://${host}`

  const script = `#!/bin/sh
set -e

INFRAWATCH_SERVER="${serverURL}"

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)        ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

DEST="/usr/local/bin/infrawatch-agent"

echo "Downloading infrawatch-agent for \${OS}/\${ARCH}..."
curl -fsSL "\${INFRAWATCH_SERVER}/api/agent/download?os=\${OS}&arch=\${ARCH}" -o "\${DEST}"
chmod +x "\${DEST}"

echo ""
echo "infrawatch-agent installed to \${DEST}"
echo ""
echo "Next steps:"
echo "  1. Create the config directory:"
echo "       sudo mkdir -p /etc/infrawatch /var/lib/infrawatch/agent"
echo ""
echo "  2. Create /etc/infrawatch/agent.toml:"
echo "       [ingest]"
echo "       address = \"<ingest-host>:9443\""
echo ""
echo "       [agent]"
echo "       org_token = \"<enrolment-token-from-ui>\""
echo ""
echo "  3. Create the systemd service:"
echo "       sudo tee /etc/systemd/system/infrawatch-agent.service > /dev/null <<'EOF'"
echo "       [Unit]"
echo "       Description=Infrawatch Agent"
echo "       After=network-online.target"
echo "       Wants=network-online.target"
echo ""
echo "       [Service]"
echo "       ExecStart=/usr/local/bin/infrawatch-agent -config /etc/infrawatch/agent.toml"
echo "       Restart=on-failure"
echo "       RestartSec=10"
echo ""
echo "       [Install]"
echo "       WantedBy=multi-user.target"
echo "       EOF"
echo ""
echo "  4. Enable and start:"
echo "       sudo systemctl daemon-reload"
echo "       sudo systemctl enable --now infrawatch-agent"
`

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
