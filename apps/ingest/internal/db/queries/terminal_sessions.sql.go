package queries

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TerminalSessionInfo is returned after validating and activating a terminal session.
type TerminalSessionInfo struct {
	InstanceID     string
	UserID         string
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
		FROM instance_settings o, hosts h
		WHERE ts.session_id       = $1
		  AND ts.websocket_token_hash = $2
		  AND ts.status           = 'pending'
		  AND COALESCE(ts.expires_at, ts.created_at + INTERVAL '5 minutes') > NOW()
		  AND o.id                = ts.instance_id
		  AND h.id                = ts.host_id
		  AND h.instance_id   = ts.instance_id
		  AND h.deleted_at        IS NULL
			RETURNING ts.instance_id, ts.host_id,
		          ts.user_id,
		          COALESCE(h.hostname, '') AS hostname,
		          COALESCE(h.ip_addresses, '[]'::jsonb)::text AS ip_addresses,
		          COALESCE(ts.username, '') AS username,
		          COALESCE((o.metadata->>'terminalLoggingEnabled')::boolean, false) AS logging_enabled
	`
	var info TerminalSessionInfo
	var hostname string
	var rawIPAddresses string
	err := pool.QueryRow(ctx, q, sessionID, tokenHash).Scan(
		&info.InstanceID,
		&info.HostID,
		&info.UserID,
		&hostname,
		&rawIPAddresses,
		&info.Username,
		&info.LoggingEnabled,
	)
	if err != nil {
		return nil, fmt.Errorf("terminal session not found or expired: %w", err)
	}
	info.Host = terminalSSHTarget(hostname, terminalIPAddressesFromJSON(rawIPAddresses))
	return &info, nil
}

func terminalIPAddressesFromJSON(raw string) []string {
	var ips []string
	if err := json.Unmarshal([]byte(raw), &ips); err != nil {
		return nil
	}
	return ips
}

func terminalSSHTarget(hostname string, ipAddresses []string) string {
	if useful := FilterHostIdentityIPs(ipAddresses); len(useful) > 0 {
		return useful[0]
	}

	if hostname = strings.TrimSpace(hostname); hostname != "" {
		return hostname
	}

	for _, ip := range ipAddresses {
		if ip = strings.TrimSpace(ip); ip != "" {
			return ip
		}
	}
	return ""
}

const (
	terminalAuthWindow      = 15 * time.Minute
	terminalAuthMaxFailures = 5
	terminalAuthBaseLockout = 5 * time.Minute
	terminalAuthMaxLockout  = time.Hour
)

type TerminalAuthThrottleStatus struct {
	Allowed    bool
	RetryAfter time.Duration

	state terminalAuthThrottleState
}

type terminalAuthThrottleKey struct {
	scope string
	key   string
}

type terminalAuthThrottleState struct {
	hits         []time.Time
	lockoutLevel int
	lockedUntil  time.Time
}

// CheckTerminalAuthThrottle verifies that another SSH password attempt is
// currently allowed for both user/host/username and source/host/username
// scopes. It also persists pruning of expired failure windows.
func CheckTerminalAuthThrottle(ctx context.Context, pool *pgxpool.Pool, info TerminalSessionInfo, source string) (TerminalAuthThrottleStatus, error) {
	return mutateTerminalAuthThrottle(ctx, pool, info, source, applyTerminalAuthCheck)
}

// RecordTerminalAuthFailure records a failed SSH password attempt in durable
// throttle state and returns whether subsequent attempts remain allowed.
func RecordTerminalAuthFailure(ctx context.Context, pool *pgxpool.Pool, info TerminalSessionInfo, source string) (TerminalAuthThrottleStatus, error) {
	return mutateTerminalAuthThrottle(ctx, pool, info, source, applyTerminalAuthFailure)
}

// ResetTerminalAuthThrottle clears failure counters after a successful SSH
// authentication so a past typo does not keep penalising legitimate use.
func ResetTerminalAuthThrottle(ctx context.Context, pool *pgxpool.Pool, info TerminalSessionInfo, source string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, key := range terminalAuthThrottleKeys(info, source) {
		if _, err := tx.Exec(ctx, `DELETE FROM security_throttles WHERE scope = $1 AND key = $2`, key.scope, key.key); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func mutateTerminalAuthThrottle(
	ctx context.Context,
	pool *pgxpool.Pool,
	info TerminalSessionInfo,
	source string,
	apply func(terminalAuthThrottleState, time.Time) TerminalAuthThrottleStatus,
) (TerminalAuthThrottleStatus, error) {
	keys := terminalAuthThrottleKeys(info, source)
	if len(keys) == 0 {
		return TerminalAuthThrottleStatus{Allowed: true}, nil
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return TerminalAuthThrottleStatus{}, err
	}
	defer tx.Rollback(ctx)

	now := time.Now().UTC()
	result := TerminalAuthThrottleStatus{Allowed: true}
	for _, key := range keys {
		state, err := loadTerminalAuthThrottleState(ctx, tx, key)
		if err != nil {
			return TerminalAuthThrottleStatus{}, err
		}

		status := apply(state, now)
		if err := storeTerminalAuthThrottleState(ctx, tx, key, status.state); err != nil {
			return TerminalAuthThrottleStatus{}, err
		}
		if !status.Allowed && (result.Allowed || status.RetryAfter > result.RetryAfter) {
			result = TerminalAuthThrottleStatus{Allowed: false, RetryAfter: status.RetryAfter}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return TerminalAuthThrottleStatus{}, err
	}
	return result, nil
}

type terminalThrottleTx interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

func loadTerminalAuthThrottleState(ctx context.Context, tx terminalThrottleTx, key terminalAuthThrottleKey) (terminalAuthThrottleState, error) {
	if _, err := tx.Exec(ctx, `
		INSERT INTO security_throttles (scope, key, hits, lockout_level)
		VALUES ($1, $2, '[]'::jsonb, 0)
		ON CONFLICT (scope, key) DO NOTHING
	`, key.scope, key.key); err != nil {
		return terminalAuthThrottleState{}, err
	}

	var hitsText string
	var lockoutLevel int
	var lockedUntil *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT hits::text, lockout_level, locked_until
		FROM security_throttles
		WHERE scope = $1 AND key = $2
		FOR UPDATE
	`, key.scope, key.key).Scan(&hitsText, &lockoutLevel, &lockedUntil); err != nil {
		return terminalAuthThrottleState{}, err
	}

	var rawHits []int64
	if err := json.Unmarshal([]byte(hitsText), &rawHits); err != nil {
		rawHits = nil
	}
	hits := make([]time.Time, 0, len(rawHits))
	for _, hit := range rawHits {
		if hit > 0 {
			hits = append(hits, time.UnixMilli(hit).UTC())
		}
	}

	state := terminalAuthThrottleState{
		hits:         hits,
		lockoutLevel: lockoutLevel,
	}
	if lockedUntil != nil {
		state.lockedUntil = lockedUntil.UTC()
	}
	return state, nil
}

func storeTerminalAuthThrottleState(ctx context.Context, tx terminalThrottleTx, key terminalAuthThrottleKey, state terminalAuthThrottleState) error {
	rawHits := make([]int64, 0, len(state.hits))
	for _, hit := range state.hits {
		rawHits = append(rawHits, hit.UTC().UnixMilli())
	}
	hitsJSON, err := json.Marshal(rawHits)
	if err != nil {
		return err
	}

	var lockedUntil any
	if !state.lockedUntil.IsZero() {
		lockedUntil = state.lockedUntil.UTC()
	}

	_, err = tx.Exec(ctx, `
		UPDATE security_throttles
		SET hits = $3::jsonb,
		    lockout_level = $4,
		    locked_until = $5,
		    updated_at = NOW()
		WHERE scope = $1 AND key = $2
	`, key.scope, key.key, string(hitsJSON), state.lockoutLevel, lockedUntil)
	return err
}

func applyTerminalAuthCheck(state terminalAuthThrottleState, now time.Time) TerminalAuthThrottleStatus {
	state.hits = pruneTerminalAuthHits(state.hits, now)
	if !state.lockedUntil.IsZero() && state.lockedUntil.After(now) {
		return TerminalAuthThrottleStatus{
			Allowed:    false,
			RetryAfter: state.lockedUntil.Sub(now),
			state:      state,
		}
	}
	state.lockedUntil = time.Time{}
	return TerminalAuthThrottleStatus{Allowed: true, state: state}
}

func applyTerminalAuthFailure(state terminalAuthThrottleState, now time.Time) TerminalAuthThrottleStatus {
	state = applyTerminalAuthCheck(state, now).state
	if !state.lockedUntil.IsZero() && state.lockedUntil.After(now) {
		return TerminalAuthThrottleStatus{
			Allowed:    false,
			RetryAfter: state.lockedUntil.Sub(now),
			state:      state,
		}
	}

	state.hits = append(state.hits, now)
	if len(state.hits) < terminalAuthMaxFailures {
		return TerminalAuthThrottleStatus{Allowed: true, state: state}
	}

	state.hits = nil
	state.lockoutLevel++
	lockout := terminalAuthLockoutDuration(state.lockoutLevel)
	state.lockedUntil = now.Add(lockout)
	return TerminalAuthThrottleStatus{
		Allowed:    false,
		RetryAfter: lockout,
		state:      state,
	}
}

func terminalAuthLockoutDuration(lockoutLevel int) time.Duration {
	if lockoutLevel <= 1 {
		return terminalAuthBaseLockout
	}
	lockout := terminalAuthBaseLockout
	for i := 1; i < lockoutLevel; i++ {
		if lockout >= terminalAuthMaxLockout/2 {
			return terminalAuthMaxLockout
		}
		lockout *= 2
	}
	if lockout > terminalAuthMaxLockout {
		return terminalAuthMaxLockout
	}
	return lockout
}

func pruneTerminalAuthHits(hits []time.Time, now time.Time) []time.Time {
	cutoff := now.Add(-terminalAuthWindow)
	pruned := hits[:0]
	for _, hit := range hits {
		if hit.After(cutoff) {
			pruned = append(pruned, hit)
		}
	}
	return pruned
}

func terminalAuthThrottleKeys(info TerminalSessionInfo, source string) []terminalAuthThrottleKey {
	username := strings.ToLower(strings.TrimSpace(info.Username))
	if info.InstanceID == "" || info.HostID == "" || username == "" {
		return nil
	}

	keys := []terminalAuthThrottleKey{}
	if info.UserID != "" {
		keys = append(keys, terminalAuthThrottleKey{
			scope: "terminal:ssh:user-host-username",
			key:   terminalAuthThrottleKeyHash(info.InstanceID, info.UserID, info.HostID, username),
		})
	}
	keys = append(keys, terminalAuthThrottleKey{
		scope: "terminal:ssh:source-host-username",
		key:   terminalAuthThrottleKeyHash(info.InstanceID, terminalAuthSource(source), info.HostID, username),
	})
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].scope == keys[j].scope {
			return keys[i].key < keys[j].key
		}
		return keys[i].scope < keys[j].scope
	})
	return keys
}

func terminalAuthSource(source string) string {
	source = strings.TrimSpace(source)
	if source == "" {
		return "unknown"
	}
	if host, _, err := net.SplitHostPort(source); err == nil && host != "" {
		return host
	}
	return source
}

func terminalAuthThrottleKeyHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
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
