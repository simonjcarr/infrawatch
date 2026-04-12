package handlers

import (
	"io"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/infrawatch/ingest/internal/auth"
	"github.com/infrawatch/ingest/internal/db/queries"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// TerminalHandler implements the Terminal bidirectional streaming RPC.
// When an agent receives a TerminalSessionRequest via HeartbeatResponse, it
// opens a Terminal stream to this handler. The handler bridges data between
// the agent's PTY and the browser's WebSocket via the TerminalStore.
type TerminalHandler struct {
	pool   *pgxpool.Pool
	issuer *auth.JWTIssuer
	store  *TerminalStore
}

// NewTerminalHandler creates a TerminalHandler.
func NewTerminalHandler(pool *pgxpool.Pool, issuer *auth.JWTIssuer, store *TerminalStore) *TerminalHandler {
	return &TerminalHandler{pool: pool, issuer: issuer, store: store}
}

// Terminal handles the bidirectional terminal stream from the agent.
//
// Flow:
//  1. Receive first message to get session_id + validate agent JWT from metadata
//  2. Look up session in TerminalStore (wait up to 30s for WebSocket handler to register it)
//  3. Bridge: fromBrowser channel → agent, agent → toBrowser channel
//  4. Clean up on disconnect
func (h *TerminalHandler) Terminal(stream agentv1.IngestService_TerminalServer) error {
	ctx := stream.Context()

	// Validate agent JWT from gRPC metadata
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "missing metadata")
	}
	authVals := md.Get("authorization")
	if len(authVals) == 0 {
		return status.Error(codes.Unauthenticated, "missing authorization header")
	}
	token := authVals[0]
	// Strip "Bearer " prefix if present
	if len(token) > 7 && token[:7] == "Bearer " {
		token = token[7:]
	}
	// Use lenient validation that accepts expired tokens. Agents hold their
	// JWT from registration time and there is no refresh mechanism yet — the
	// token regularly outlives its 24h TTL. The signature is still verified,
	// so the identity is trustworthy.
	agentID, _, err := h.issuer.ValidateAgentTokenAllowExpired(token)
	if err != nil {
		return status.Errorf(codes.Unauthenticated, "invalid agent token: %v", err)
	}

	// Receive first message (handshake) with session_id
	first, err := stream.Recv()
	if err == io.EOF {
		return nil
	}
	if err != nil {
		return status.Errorf(codes.Internal, "receiving first terminal message: %v", err)
	}
	sessionID := first.SessionId
	if sessionID == "" {
		return status.Error(codes.InvalidArgument, "session_id required in first message")
	}

	slog.Info("terminal grpc: agent connected", "agent_id", agentID, "session_id", sessionID)

	// Wait for the WebSocket handler to register the session in the store
	sess, found := h.store.WaitFor(sessionID, 30*time.Second)
	if !found {
		slog.Warn("terminal grpc: session not found in store", "session_id", sessionID)
		if err := queries.SetTerminalSessionError(ctx, h.pool, sessionID, "agent connected but no browser session found"); err != nil {
			slog.Warn("terminal grpc: failed to set session error", "session_id", sessionID, "err", err)
		}
		return status.Error(codes.NotFound, "terminal session not found in store")
	}

	// Signal the WS handler that the agent has connected and the bridge is up.
	close(sess.agentConnected)

	// Goroutine: read from fromBrowser channel → parse → send to agent via stream
	agentDone := make(chan struct{})
	go func() {
		defer close(agentDone)
		for {
			select {
			case <-ctx.Done():
				return
			case frame, ok := <-sess.fromBrowser:
				if !ok {
					return
				}
				if len(frame) == 0 {
					continue
				}

				var msg *agentv1.TerminalServerMessage
				switch frame[0] {
				case 0x00: // input data
					msg = &agentv1.TerminalServerMessage{
						SessionId: sessionID,
						Payload:   &agentv1.TerminalServerMessage_Input{Input: frame[1:]},
					}
				case resizePrefix: // resize
					if len(frame) < 5 {
						continue
					}
					cols := uint32(frame[1])<<8 | uint32(frame[2])
					rows := uint32(frame[3])<<8 | uint32(frame[4])
					msg = &agentv1.TerminalServerMessage{
						SessionId: sessionID,
						Payload: &agentv1.TerminalServerMessage_Resize{
							Resize: &agentv1.TerminalResizeMsg{Cols: cols, Rows: rows},
						},
					}
				case closePrefix: // close
					msg = &agentv1.TerminalServerMessage{
						SessionId: sessionID,
						Payload:   &agentv1.TerminalServerMessage_Close{Close: true},
					}
				default:
					continue
				}

				if err := stream.Send(msg); err != nil {
					slog.Debug("terminal grpc: send to agent failed", "session_id", sessionID, "err", err)
					return
				}
			}
		}
	}()

	// Main loop: read from agent stream → write to toBrowser channel
	for {
		agentMsg, err := stream.Recv()
		if err == io.EOF {
			slog.Info("terminal grpc: agent stream EOF", "session_id", sessionID)
			break
		}
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			slog.Warn("terminal grpc: recv error", "session_id", sessionID, "err", err)
			break
		}

		switch p := agentMsg.Payload.(type) {
		case *agentv1.TerminalAgentMessage_Output:
			select {
			case sess.toBrowser <- p.Output:
			case <-ctx.Done():
				return nil
			}
		case *agentv1.TerminalAgentMessage_Closed:
			slog.Info("terminal grpc: shell exited", "session_id", sessionID, "exit_code", p.Closed.ExitCode)
			// Signal browser that the session is over by closing the channel
			close(sess.toBrowser)
			return nil
		}
	}

	return nil
}
