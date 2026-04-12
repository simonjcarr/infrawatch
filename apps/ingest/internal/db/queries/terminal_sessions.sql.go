package queries

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// TerminalSessionInfo is returned after validating and activating a terminal session.
type TerminalSessionInfo struct {
	OrganisationID string
	HostID         string
	LoggingEnabled bool
}

// ValidateAndActivateTerminalSession looks up a terminal session by session_id,
// verifies it is 'pending' and was created within the last 5 minutes, and
// transitions it to 'active'. Returns org/host IDs and whether logging is enabled.
func ValidateAndActivateTerminalSession(ctx context.Context, pool *pgxpool.Pool, sessionID string) (*TerminalSessionInfo, error) {
	const q = `
		UPDATE terminal_sessions ts
		SET status     = 'active',
		    started_at = NOW(),
		    updated_at = NOW()
		FROM organisations o
		WHERE ts.session_id       = $1
		  AND ts.status           = 'pending'
		  AND ts.created_at       > NOW() - INTERVAL '5 minutes'
		  AND o.id                = ts.organisation_id
		RETURNING ts.organisation_id, ts.host_id,
		          COALESCE((o.metadata->>'terminalLoggingEnabled')::boolean, false) AS logging_enabled
	`
	var info TerminalSessionInfo
	err := pool.QueryRow(ctx, q, sessionID).Scan(&info.OrganisationID, &info.HostID, &info.LoggingEnabled)
	if err != nil {
		return nil, fmt.Errorf("terminal session not found or expired: %w", err)
	}
	return &info, nil
}

// GetPendingTerminalSessionsForHost returns terminal sessions that are 'active'
// (validated by the WebSocket handler) but not yet picked up by the agent.
// Sessions older than 30 seconds are considered stale and skipped.
func GetPendingTerminalSessionsForHost(ctx context.Context, pool *pgxpool.Pool, hostID string) ([]*agentv1.TerminalSessionRequest, error) {
	const q = `
		SELECT session_id
		FROM terminal_sessions
		WHERE host_id    = $1
		  AND status     = 'active'
		  AND started_at > NOW() - INTERVAL '30 seconds'
	`
	rows, err := pool.Query(ctx, q, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*agentv1.TerminalSessionRequest
	for rows.Next() {
		var sessionID string
		if err := rows.Scan(&sessionID); err != nil {
			return nil, err
		}
		result = append(result, &agentv1.TerminalSessionRequest{
			SessionId: sessionID,
			Cols:      80,
			Rows:      24,
		})
	}
	return result, rows.Err()
}

// SetTerminalSessionEnded marks a terminal session as 'ended' with duration and
// optional recording.
func SetTerminalSessionEnded(ctx context.Context, pool *pgxpool.Pool, sessionID string, durationSecs int, recording string) error {
	var recordingArg interface{}
	if recording != "" {
		recordingArg = recording
	}
	const q = `
		UPDATE terminal_sessions
		SET status           = 'ended',
		    ended_at         = NOW(),
		    duration_seconds = $2,
		    recording        = $3,
		    updated_at       = NOW()
		WHERE session_id = $1
		  AND status IN ('pending', 'active')
	`
	_, err := pool.Exec(ctx, q, sessionID, durationSecs, recordingArg)
	return err
}

// SetTerminalSessionError marks a terminal session as 'error'.
func SetTerminalSessionError(ctx context.Context, pool *pgxpool.Pool, sessionID, reason string) error {
	const q = `
		UPDATE terminal_sessions
		SET status     = 'error',
		    ended_at   = NOW(),
		    updated_at = NOW()
		WHERE session_id = $1
		  AND status IN ('pending', 'active')
	`
	_, err := pool.Exec(ctx, q, sessionID)
	if err != nil {
		return err
	}
	return nil
}

// GetTerminalSessionStatus returns the current status of a terminal session by session_id.
func GetTerminalSessionStatus(ctx context.Context, pool *pgxpool.Pool, sessionID string) (string, error) {
	const q = `SELECT status FROM terminal_sessions WHERE session_id = $1`
	var status string
	err := pool.QueryRow(ctx, q, sessionID).Scan(&status)
	return status, err
}

// CleanupTerminalSessionsForHost marks all pending/active terminal sessions for
// a host as 'error'. Used when an agent disconnects.
func CleanupTerminalSessionsForHost(ctx context.Context, pool *pgxpool.Pool, hostID string) error {
	const q = `
		UPDATE terminal_sessions
		SET status     = 'error',
		    ended_at   = NOW(),
		    updated_at = NOW()
		WHERE host_id = $1
		  AND status IN ('pending', 'active')
	`
	_, err := pool.Exec(ctx, q, hostID)
	return err
}
