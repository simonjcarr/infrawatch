package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infrawatch/ingest/internal/db/queries"
)

// TerminalWSHandler serves WebSocket connections for interactive terminal sessions.
type TerminalWSHandler struct {
	pool  *pgxpool.Pool
	store *TerminalStore
}

// NewTerminalWSHandler creates a new WebSocket handler for terminal sessions.
func NewTerminalWSHandler(pool *pgxpool.Pool, store *TerminalStore) *TerminalWSHandler {
	return &TerminalWSHandler{pool: pool, store: store}
}

// wsMessage is the JSON envelope for browser ↔ ingest WebSocket messages.
type wsMessage struct {
	Type string `json:"type"`           // "input" | "resize" | "close" | "output" | "closed" | "error"
	Data string `json:"data,omitempty"` // base64-encoded for input/output
	Cols uint32 `json:"cols,omitempty"`
	Rows uint32 `json:"rows,omitempty"`
	Msg  string `json:"message,omitempty"`
	Code int32  `json:"exit_code,omitempty"`
}

// resizeFrame is a control frame sent on fromBrowser to signal a resize.
// The first byte is 0x01 to distinguish it from regular input (0x00 prefix).
const resizePrefix = 0x01
const closePrefix = 0x02

// ServeHTTP handles the /ws/terminal/{sessionId} endpoint.
func (h *TerminalWSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract session ID from URL path: /ws/terminal/{sessionId}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/ws/terminal/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "missing session ID", http.StatusBadRequest)
		return
	}
	sessionID := parts[0]

	// Accept WebSocket upgrade
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // allow cross-origin for dev; production uses reverse proxy
	})
	if err != nil {
		slog.Warn("terminal ws: accept failed", "err", err)
		return
	}
	defer conn.CloseNow()

	ctx := r.Context()

	// Validate and activate session in DB
	info, err := queries.ValidateAndActivateTerminalSession(ctx, h.pool, sessionID)
	if err != nil {
		slog.Warn("terminal ws: invalid session", "session_id", sessionID, "err", err)
		msg, _ := json.Marshal(wsMessage{Type: "error", Msg: "Invalid or expired terminal session"})
		conn.Write(ctx, websocket.MessageText, msg)
		conn.Close(websocket.StatusPolicyViolation, "invalid session")
		return
	}

	slog.Info("terminal ws: session activated", "session_id", sessionID, "host_id", info.HostID, "org_id", info.OrganisationID)

	// Register in terminal store so the gRPC Terminal handler can find us
	sess, sessCtx := h.store.Register(sessionID, info.LoggingEnabled)

	// Clean up on exit
	defer func() {
		h.store.Remove(sessionID)
		duration := int(time.Since(sess.startedAt).Seconds())
		recording := sess.getRecording()
		if err := queries.SetTerminalSessionEnded(context.Background(), h.pool, sessionID, duration, recording); err != nil {
			slog.Warn("terminal ws: failed to record session end", "session_id", sessionID, "err", err)
		}
		slog.Info("terminal ws: session ended", "session_id", sessionID, "duration_seconds", duration)
	}()

	// Goroutine: notify browser when agent connects, then relay PTY output
	done := make(chan struct{})
	go func() {
		defer close(done)

		// Poll DB status every 3s and report to browser while waiting for agent.
		// This helps diagnose whether the heartbeat finds and pushes the session.
		diagTicker := time.NewTicker(3 * time.Second)
		defer diagTicker.Stop()

		for {
			select {
			case <-sess.agentConnected:
				slog.Info("terminal ws: agent connected, bridge is up", "session_id", sessionID)
				agentMsg, _ := json.Marshal(wsMessage{Type: "agent_connected"})
				if err := conn.Write(ctx, websocket.MessageText, agentMsg); err != nil {
					return
				}
				goto relayOutput
			case <-sessCtx.Done():
				return
			case <-diagTicker.C:
				dbStatus, err := queries.GetTerminalSessionStatus(ctx, h.pool, sessionID)
				if err != nil {
					slog.Warn("terminal ws: diag status query failed", "session_id", sessionID, "err", err)
					continue
				}
				// Run the same query the heartbeat uses to find pending sessions
				pendingSessions, _ := queries.GetPendingTerminalSessionsForHost(ctx, h.pool, info.HostID)
				// Check if the store has this session registered and how many times pushed
				storeSess, inStore := h.store.Get(sessionID)
				var pushCount int64
				if storeSess != nil {
					pushCount = storeSess.getPushCount()
				}
				// Check agent status and verify host_id reverse-lookup
				agentID, agentStatus, _ := queries.GetHostAgentStatus(ctx, h.pool, info.HostID)
				reverseHostID := ""
				if agentID != "" {
					reverseHostID, _ = queries.GetHostByAgentID(ctx, h.pool, agentID)
				}
				hostMatch := reverseHostID == info.HostID
				diagMsg, _ := json.Marshal(wsMessage{
					Type: "diagnostic",
					Msg: fmt.Sprintf("status=%s host_id=%s poll_would_find=%d in_store=%v pushed=%d agent=%s(%s) host_match=%v",
						dbStatus, info.HostID, len(pendingSessions), inStore, pushCount, agentStatus, agentID, hostMatch),
				})
				if err := conn.Write(ctx, websocket.MessageText, diagMsg); err != nil {
					return
				}
			}
		}

	relayOutput:

		// Relay PTY output from the gRPC handler to the browser.
		for {
			select {
			case <-sessCtx.Done():
				return
			case data, ok := <-sess.toBrowser:
				if !ok {
					return
				}
				sess.appendRecording(data)
				msg, _ := json.Marshal(wsMessage{
					Type: "output",
					Data: base64.StdEncoding.EncodeToString(data),
				})
				if err := conn.Write(ctx, websocket.MessageText, msg); err != nil {
					return
				}
			}
		}
	}()

	// Main loop: read from WebSocket → parse → write to fromBrowser channel
	for {
		select {
		case <-sessCtx.Done():
			return
		case <-done:
			// Agent closed the PTY, send closed message to browser
			msg, _ := json.Marshal(wsMessage{Type: "closed"})
			conn.Write(ctx, websocket.MessageText, msg)
			conn.Close(websocket.StatusNormalClosure, "session ended")
			return
		default:
		}

		_, rawMsg, err := conn.Read(ctx)
		if err != nil {
			// Browser disconnected
			slog.Debug("terminal ws: read error", "session_id", sessionID, "err", err)
			return
		}

		var msg wsMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			decoded, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil {
				continue
			}
			// Prefix with 0x00 to mark as input data
			frame := append([]byte{0x00}, decoded...)
			select {
			case sess.fromBrowser <- frame:
			case <-sessCtx.Done():
				return
			}

		case "resize":
			// Encode resize as a control frame: [0x01, cols_hi, cols_lo, rows_hi, rows_lo]
			frame := []byte{
				resizePrefix,
				byte(msg.Cols >> 8), byte(msg.Cols & 0xff),
				byte(msg.Rows >> 8), byte(msg.Rows & 0xff),
			}
			select {
			case sess.fromBrowser <- frame:
			case <-sessCtx.Done():
				return
			}

		case "close":
			frame := []byte{closePrefix}
			select {
			case sess.fromBrowser <- frame:
			case <-sessCtx.Done():
				return
			}
			return
		}
	}
}
