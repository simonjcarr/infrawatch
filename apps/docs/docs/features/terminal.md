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
