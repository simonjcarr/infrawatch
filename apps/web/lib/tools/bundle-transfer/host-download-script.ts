import path from 'node:path'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildHostDownloadScript(params: {
  downloadUrl: string
  directory: string
  fileName: string
  owner: string
  expectedSha256: string
}) {
  const destination = path.posix.join(params.directory, params.fileName)
  return [
    'set -eu',
    `DEST_DIR=${shellQuote(params.directory)}`,
    `DEST_FILE=${shellQuote(params.fileName)}`,
    `DEST_PATH=${shellQuote(destination)}`,
    `DOWNLOAD_URL=${shellQuote(params.downloadUrl)}`,
    `OWNER=${shellQuote(params.owner)}`,
    `EXPECTED_SHA256=${shellQuote(params.expectedSha256)}`,
    'TMP_PATH="${DEST_DIR}/.${DEST_FILE}.ct-ops-transfer.$$"',
    'cleanup() { rm -f "$TMP_PATH"; }',
    'trap cleanup INT TERM EXIT',
    'mkdir -p "$DEST_DIR"',
    'echo "Downloading bundle to ${DEST_PATH}"',
    'if command -v curl >/dev/null 2>&1; then',
    '  curl -fL --retry 3 --connect-timeout 20 --output "$TMP_PATH" "$DOWNLOAD_URL"',
    'elif command -v wget >/dev/null 2>&1; then',
    '  wget --tries=3 --timeout=20 -O "$TMP_PATH" "$DOWNLOAD_URL"',
    'else',
    '  echo "Neither curl nor wget is installed on this host" >&2',
    '  exit 127',
    'fi',
    'if command -v sha256sum >/dev/null 2>&1; then',
    '  printf "%s  %s\\n" "$EXPECTED_SHA256" "$TMP_PATH" | sha256sum -c -',
    'elif command -v shasum >/dev/null 2>&1; then',
    '  printf "%s  %s\\n" "$EXPECTED_SHA256" "$TMP_PATH" | shasum -a 256 -c -',
    'else',
    '  echo "Neither sha256sum nor shasum is installed on this host" >&2',
    '  exit 127',
    'fi',
    'mv -f "$TMP_PATH" "$DEST_PATH"',
    'trap - INT TERM EXIT',
    'if [ -n "$OWNER" ] && command -v chown >/dev/null 2>&1 && id "$OWNER" >/dev/null 2>&1; then',
    '  chown "$OWNER" "$DEST_PATH" || true',
    'fi',
    'echo "Bundle transferred to ${DEST_PATH}"',
  ].join('\n')
}
