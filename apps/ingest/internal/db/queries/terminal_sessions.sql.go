package queries

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TerminalSessionInfo is returned after validating and activating a terminal session.
type TerminalSessionInfo struct {
	OrganisationID string
	HostID         string
	Host           string
	Username       string
	LoggingEnabled bool
}

var (
	ErrSSHHostKeyNotTrusted = errors.New("SSH host key is not trusted")
	ErrSSHHostKeyMismatch   = errors.New("SSH host key mismatch")
)

// ValidateAndActivateTerminalSession looks up a terminal session by session_id
// and a one-time WebSocket token hash, verifies it is pending and unexpired,
// and transitions it to active. Returns the SSH target and host username.
func ValidateAndActivateTerminalSession(ctx context.Context, pool *pgxpool.Pool, sessionID string, tokenHash string) (*TerminalSessionInfo, error) {
	const q = `
		UPDATE terminal_sessions ts
		SET status     = 'active',
		    started_at = NOW(),
		    updated_at = NOW()
		FROM organisations o, hosts h
		WHERE ts.session_id       = $1
		  AND ts.websocket_token_hash = $2
		  AND ts.status           = 'pending'
		  AND COALESCE(ts.expires_at, ts.created_at + INTERVAL '5 minutes') > NOW()
		  AND o.id                = ts.organisation_id
		  AND h.id                = ts.host_id
		  AND h.organisation_id   = ts.organisation_id
		  AND h.deleted_at        IS NULL
		RETURNING ts.organisation_id, ts.host_id,
		          COALESCE(NULLIF(h.hostname, ''), h.ip_addresses->>0) AS host,
		          COALESCE(ts.username, '') AS username,
		          COALESCE((o.metadata->>'terminalLoggingEnabled')::boolean, false) AS logging_enabled
	`
	var info TerminalSessionInfo
	err := pool.QueryRow(ctx, q, sessionID, tokenHash).Scan(
		&info.OrganisationID,
		&info.HostID,
		&info.Host,
		&info.Username,
		&info.LoggingEnabled,
	)
	if err != nil {
		return nil, fmt.Errorf("terminal session not found or expired: %w", err)
	}
	return &info, nil
}

func VerifySSHHostKey(ctx context.Context, pool *pgxpool.Pool, hostID string, fingerprint string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	const selectQ = `
		SELECT COALESCE(metadata, '{}'::jsonb)
		FROM hosts
		WHERE id = $1
		  AND deleted_at IS NULL
		FOR UPDATE
	`
	var metadata []byte
	if err := tx.QueryRow(ctx, selectQ, hostID).Scan(&metadata); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("host not found")
		}
		return err
	}
	if err := verifySSHHostKeyMetadata(metadata, fingerprint); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func verifySSHHostKeyMetadata(metadata []byte, fingerprint string) error {
	var parsed sshHostKeyMetadata
	if len(metadata) > 0 {
		if err := json.Unmarshal(metadata, &parsed); err != nil {
			return err
		}
	}
	if parsed.SSHHostKeyStatus == "changed" && len(parsed.PendingSSHHostKeys) > 0 {
		return ErrSSHHostKeyMismatch
	}
	trusted := normaliseSSHHostKeys(parsed.SSHHostKeys)
	if len(trusted) == 0 {
		return verifySSHHostKeyFingerprint(ptrOrNil(parsed.SSHHostKeySha256), fingerprint)
	}
	for _, key := range trusted {
		if key.FingerprintSHA256 == fingerprint {
			return nil
		}
	}
	return ErrSSHHostKeyMismatch
}

func verifySSHHostKeyFingerprint(current *string, fingerprint string) error {
	if current == nil || *current == "" {
		return ErrSSHHostKeyNotTrusted
	}
	if *current != fingerprint {
		return ErrSSHHostKeyMismatch
	}
	return nil
}

func ptrOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
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
