# Terminal

Infrawatch provides a persistent, browser-based terminal that gives you shell access to any host that has an active agent — without needing SSH configured or a VPN connection.

---

## How It Works

The terminal uses a WebSocket connection from the browser to the web app, which forwards the PTY session through the agent's bidirectional gRPC stream to the host. The agent spawns a shell process and proxies stdin/stdout/stderr.

```
Browser ──WebSocket──► Web App ──gRPC bidirectional──► Agent ──PTY──► Shell
```

No SSH daemon is required on the target host. The agent handles the shell session entirely.

---

## Opening a Terminal

From any host detail page, click the **Terminal** tab. A terminal session opens in the bottom panel.

Alternatively, click the terminal icon in the bottom status bar to open the persistent terminal panel from anywhere in the application.

---

## Terminal Panel

The terminal panel is a persistent, VS Code-style panel pinned to the bottom of the viewport. It stays visible as you navigate between pages — your terminal sessions are not interrupted when you switch to a different host or page.

### Tabs

Each host session opens in its own tab. You can have multiple simultaneous sessions open:
- Click the **+** button to open a new session
- Click a tab to switch between sessions
- Close a tab to end the session

### Tab persistence

Open tabs (and which host they're connected to) are persisted across browser refreshes via `localStorage`. Your session layout is restored when you reopen the browser.

---

## Shell Detection

The agent automatically selects the appropriate shell for the host:

- **Linux** — detects `bash` first, falls back to `sh`
- **macOS** — `zsh` first, then `bash`, then `sh`

The shell is launched as the `infrawatch` service user on the host. The user must have the appropriate permissions for the commands you need to run.

---

## Security Considerations

Terminal access requires the `engineer` or `super_admin` role. `read_only` users cannot open terminal sessions.

All terminal sessions are logged to the event spine — commands typed and output produced are retained for audit purposes. Session logs are accessible from the host detail page event timeline.

---

## Authentication

Each terminal session authenticates using per-user credentials derived from the agent JWT. The web app issues a short-lived session token for each terminal tab. This token is included in the WebSocket handshake and validated by the agent before the shell is spawned.
