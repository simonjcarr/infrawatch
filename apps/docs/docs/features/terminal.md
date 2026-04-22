# Terminal

CT-Ops provides a persistent, browser-based terminal that gives you shell access to any host that has an active agent — without needing SSH configured or a VPN connection.

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

### Reordering tabs

Drag a tab left or right along the tab bar to reorder it. The new order is persisted with the rest of the terminal state.

### Renaming tabs

Double-click a tab (or right-click → **Rename**) to give it a custom label. Press **Enter** to commit or **Escape** to cancel. Clearing the label reverts to the host's name. The username, when shown, is hidden once a custom label is set.

### Tab colours

Right-click a tab and choose **Tab colour** to assign one of the preset colours (slate, red, amber, emerald, sky, violet, pink). The chosen colour is shown as a thin accent bar on the left edge of the tab and a subtle tint on the active tab — useful for distinguishing production hosts from staging, or grouping related sessions visually. Select **No colour** to clear the assignment.

### Split panes

Each tab can host multiple terminal panes connected to the same host. Splits are useful for running `tail -f` in one pane while you work in another, or watching a process while reading its logs.

- **Right-click a tab → Split right / Split down** — splits the currently focused pane in the chosen direction and opens a new session on the same host.
- **Hover over a pane** — action buttons appear in the top-right for Split right, Split down, and Close pane.
- **Drag the divider** between two panes to resize them.
- **Click inside a pane** to make it active; split actions operate on the active pane.
- Closing the last pane in a tab also closes the tab.

All panes in a tab share the same host/user binding — they are independent shell sessions, not a shared shell.

### Tab persistence

Open tabs, their order, colours, labels, and pane layout are persisted across navigation and browser refreshes via `sessionStorage`. The live shell sessions themselves are not restored on refresh — each pane reconnects and starts a new shell when the page loads.

---

## Terminal Settings

### Default text size

Click the **settings** (gear) icon in the terminal panel toolbar to open terminal preferences. The default text size slider controls the font used by every terminal tab. Changes apply immediately to all open terminals and are remembered across browser sessions (per user, per browser — stored in `localStorage`).

Preset sizes are available for quick selection, with a reset button to return to the built-in default (13px).

### Per-tab text size override

To change the text size for a single tab without affecting the others, right-click the tab and choose **Text size**. Pick a preset size, or select **Use default** to clear the override and follow the global setting again. Per-tab overrides are remembered with the tab and persist until the tab is closed.

This is useful for giving more pixels to a log-tail pane, or boosting a shared screen so attendees can read the commands being typed.

---

## Shell Detection

The agent automatically selects the appropriate shell for the host:

- **Linux** — detects `bash` first, falls back to `sh`
- **macOS** — `zsh` first, then `bash`, then `sh`

The shell is launched as the `ct-ops` service user on the host. The user must have the appropriate permissions for the commands you need to run.

---

## Security Considerations

Terminal access requires the `engineer` or `super_admin` role. `read_only` users cannot open terminal sessions.

All terminal sessions are logged to the event spine — commands typed and output produced are retained for audit purposes. Session logs are accessible from the host detail page event timeline.

---

## Authentication

Each terminal session authenticates using per-user credentials derived from the agent JWT. The web app issues a short-lived session token for each terminal tab. This token is included in the WebSocket handshake and validated by the agent before the shell is spawned.

---

## Deployment: Reverse Proxies and Cloudflare Tunnels

The terminal relies on a WebSocket connection from the browser to the ingest service on port `8080`. The `INGEST_WS_URL` environment variable controls which URL the browser uses.

There are two supported modes.

### Direct mode (default)

`INGEST_WS_URL=ws://host:8080` (or `wss://host:8080`). The browser opens the WebSocket directly to that URL. This is the simplest setup for local/LAN deployments where the ingest port is reachable from every user's browser.

### Same-origin mode (reverse proxy / Cloudflare tunnel)

Leave `INGEST_WS_URL` blank. The browser opens the WebSocket against the page's own origin, e.g. `wss://ct-ops.example.com/ws/terminal/<id>`. Your reverse proxy or tunnel must route `/ws/terminal/*` to the ingest service on port `8080` and forward the HTTP Upgrade header.

This is the mode to use when only the web app is publicly reachable (for example, when you expose the server through a Cloudflare tunnel that points at the web container on port `3000`).

#### Cloudflare Tunnel example

In your `cloudflared` config, add a path-based ingress rule for `/ws/terminal/*` **before** the catch-all rule for the web app:

```yaml
ingress:
  - hostname: ct-ops.example.com
    path: ^/ws/terminal/.*
    service: http://localhost:8080
  - hostname: ct-ops.example.com
    service: http://localhost:3000
  - service: http_status:404
```

If you use the Cloudflare dashboard's Public Hostname UI, create two public hostnames for the same domain: one with Path set to `^/ws/terminal/.*` pointing at `http://localhost:8080`, and a second with no path pointing at `http://localhost:3000`. Cloudflare Tunnels forward WebSocket upgrades transparently — no extra configuration is needed on the tunnel side.

Then either unset `INGEST_WS_URL` in your `.env` or set it to an empty value:

```env
INGEST_WS_URL=
```

#### Nginx example

```nginx
location /ws/terminal/ {
    proxy_pass http://ingest:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location / {
    proxy_pass http://web:3000;
    proxy_set_header Host $host;
}
```

#### Caddy example

```caddy
ct-ops.example.com {
    reverse_proxy /ws/terminal/* ingest:8080
    reverse_proxy web:3000
}
```

### Troubleshooting

If the terminal spins at "Connecting…" and never attaches:

- **Check the browser's network tab** for the WebSocket request. It should show a `101 Switching Protocols` response. If you see a `502`, `503`, `520`, or the request times out, your reverse proxy is not forwarding the Upgrade header or cannot reach the ingest service.
- **Verify that `/ws/terminal/...` is routed to port 8080**, not port 3000 — the web app does not answer this path.
- **Confirm your tunnel forwards WebSockets**. Cloudflare Tunnels do so by default; other proxies may need explicit Upgrade/Connection header forwarding.
- **If `INGEST_WS_URL` is set to an absolute URL**, the browser will ignore same-origin routing and try to connect directly. Make sure the URL is reachable from every user's browser, or clear the variable to switch to same-origin mode.
