package loadtest

import (
	"context"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// simulateTerminalSession opens a Terminal bidi stream, emits a short fake
// shell banner, then sends a clean "closed" message. This is enough to
// exercise the server's terminal-session lifecycle path without simulating a
// real PTY — the v1 load tester treats every terminal session as a very
// short-lived ping.
func (v *VirtualAgent) simulateTerminalSession(ctx context.Context, client agentv1.IngestServiceClient, req *agentv1.TerminalSessionRequest) {
	stream, err := client.Terminal(ctx)
	if err != nil {
		v.stats.RecordError(truncate("terminal open: "+err.Error(), 200))
		return
	}

	// Handshake message — first send must carry the session_id with no payload.
	if err := stream.Send(&agentv1.TerminalAgentMessage{SessionId: req.SessionId}); err != nil {
		v.stats.RecordError(truncate("terminal handshake: "+err.Error(), 200))
		return
	}

	// Short delay + one banner, then clean close.
	select {
	case <-ctx.Done():
		return
	case <-time.After(200 * time.Millisecond):
	}

	_ = stream.Send(&agentv1.TerminalAgentMessage{
		SessionId: req.SessionId,
		Payload:   &agentv1.TerminalAgentMessage_Output{Output: []byte("loadtest-virtual-shell$ \r\n")},
	})
	_ = stream.Send(&agentv1.TerminalAgentMessage{
		SessionId: req.SessionId,
		Payload:   &agentv1.TerminalAgentMessage_Closed{Closed: &agentv1.TerminalClosedMsg{ExitCode: 0}},
	})
	_ = stream.CloseSend()

	v.stats.TerminalSessions.Add(1)
}
