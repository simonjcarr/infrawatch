package queries

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SSHHostKey struct {
	Algorithm         string `json:"algorithm"`
	FingerprintSHA256 string `json:"fingerprintSha256"`
}

type sshHostKeyMetadata struct {
	SSHHostKeySha256    string                 `json:"sshHostKeySha256,omitempty"`
	SSHHostKeys         []SSHHostKey           `json:"sshHostKeys,omitempty"`
	PendingSSHHostKeys  []SSHHostKey           `json:"pendingSshHostKeys,omitempty"`
	SSHHostKeyStatus    string                 `json:"sshHostKeyStatus,omitempty"`
	SSHHostKeyChangedAt string                 `json:"sshHostKeyChangedAt,omitempty"`
	Extra               map[string]interface{} `json:"-"`
}

func (m *sshHostKeyMetadata) UnmarshalJSON(data []byte) error {
	type alias sshHostKeyMetadata
	var raw map[string]interface{}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &raw); err != nil {
			return err
		}
	}
	var parsed alias
	if len(data) > 0 {
		if err := json.Unmarshal(data, &parsed); err != nil {
			return err
		}
	}
	delete(raw, "sshHostKeySha256")
	delete(raw, "sshHostKeys")
	delete(raw, "pendingSshHostKeys")
	delete(raw, "sshHostKeyStatus")
	delete(raw, "sshHostKeyChangedAt")
	*m = sshHostKeyMetadata(parsed)
	m.Extra = raw
	return nil
}

func (m sshHostKeyMetadata) MarshalJSON() ([]byte, error) {
	raw := m.Extra
	if raw == nil {
		raw = map[string]interface{}{}
	}
	if m.SSHHostKeySha256 != "" {
		raw["sshHostKeySha256"] = m.SSHHostKeySha256
	} else {
		delete(raw, "sshHostKeySha256")
	}
	if len(m.SSHHostKeys) > 0 {
		raw["sshHostKeys"] = m.SSHHostKeys
	} else {
		delete(raw, "sshHostKeys")
	}
	if len(m.PendingSSHHostKeys) > 0 {
		raw["pendingSshHostKeys"] = m.PendingSSHHostKeys
	} else {
		delete(raw, "pendingSshHostKeys")
	}
	if m.SSHHostKeyStatus != "" {
		raw["sshHostKeyStatus"] = m.SSHHostKeyStatus
	} else {
		delete(raw, "sshHostKeyStatus")
	}
	if m.SSHHostKeyChangedAt != "" {
		raw["sshHostKeyChangedAt"] = m.SSHHostKeyChangedAt
	} else {
		delete(raw, "sshHostKeyChangedAt")
	}
	return json.Marshal(raw)
}

func ReportSSHHostKeys(ctx context.Context, pool *pgxpool.Pool, hostID string, reported []SSHHostKey) error {
	reported = normaliseSSHHostKeys(reported)
	if len(reported) == 0 {
		return nil
	}

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
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}

	next, changed, err := applyReportedSSHHostKeys(metadata, reported)
	if err != nil {
		return err
	}
	if !changed {
		return tx.Commit(ctx)
	}

	nextJSON, err := json.Marshal(next)
	if err != nil {
		return err
	}
	const updateQ = `
		UPDATE hosts
		SET metadata = $2::jsonb,
		    updated_at = NOW()
		WHERE id = $1
		  AND deleted_at IS NULL
	`
	if _, err := tx.Exec(ctx, updateQ, hostID, string(nextJSON)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func AcceptPendingSSHHostKeys(ctx context.Context, pool *pgxpool.Pool, hostID string) error {
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
		return err
	}

	next, err := acceptPendingSSHHostKeysMetadata(metadata)
	if err != nil {
		return err
	}
	nextJSON, err := json.Marshal(next)
	if err != nil {
		return err
	}
	const updateQ = `
		UPDATE hosts
		SET metadata = $2::jsonb,
		    updated_at = NOW()
		WHERE id = $1
		  AND deleted_at IS NULL
	`
	if _, err := tx.Exec(ctx, updateQ, hostID, string(nextJSON)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func applyReportedSSHHostKeys(currentJSON []byte, reported []SSHHostKey) (sshHostKeyMetadata, bool, error) {
	var current sshHostKeyMetadata
	if len(currentJSON) > 0 {
		if err := json.Unmarshal(currentJSON, &current); err != nil {
			return current, false, err
		}
	}

	reported = normaliseSSHHostKeys(reported)
	if len(reported) == 0 {
		return current, false, nil
	}

	trusted := normaliseSSHHostKeys(current.SSHHostKeys)
	if len(trusted) == 0 && current.SSHHostKeySha256 != "" {
		trusted = []SSHHostKey{{FingerprintSHA256: current.SSHHostKeySha256}}
	}

	if len(trusted) == 0 {
		current.SSHHostKeys = reported
		current.SSHHostKeySha256 = reported[0].FingerprintSHA256
		current.PendingSSHHostKeys = nil
		current.SSHHostKeyStatus = ""
		current.SSHHostKeyChangedAt = ""
		return current, true, nil
	}

	current.SSHHostKeys = trusted
	current.SSHHostKeySha256 = trusted[0].FingerprintSHA256
	if sameSSHHostKeys(trusted, reported) {
		changed := len(current.PendingSSHHostKeys) > 0 || current.SSHHostKeyStatus != "" || current.SSHHostKeyChangedAt != ""
		current.PendingSSHHostKeys = nil
		current.SSHHostKeyStatus = ""
		current.SSHHostKeyChangedAt = ""
		return current, changed, nil
	}

	if sameSSHHostKeys(current.PendingSSHHostKeys, reported) && current.SSHHostKeyStatus == "changed" {
		return current, false, nil
	}

	current.PendingSSHHostKeys = reported
	current.SSHHostKeyStatus = "changed"
	current.SSHHostKeyChangedAt = time.Now().UTC().Format(time.RFC3339)
	return current, true, nil
}

func acceptPendingSSHHostKeysMetadata(currentJSON []byte) (sshHostKeyMetadata, error) {
	var current sshHostKeyMetadata
	if len(currentJSON) > 0 {
		if err := json.Unmarshal(currentJSON, &current); err != nil {
			return current, err
		}
	}
	pending := normaliseSSHHostKeys(current.PendingSSHHostKeys)
	if len(pending) == 0 {
		return current, errors.New("no pending SSH host keys to accept")
	}
	current.SSHHostKeys = pending
	current.SSHHostKeySha256 = pending[0].FingerprintSHA256
	current.PendingSSHHostKeys = nil
	current.SSHHostKeyStatus = ""
	current.SSHHostKeyChangedAt = ""
	return current, nil
}

func normaliseSSHHostKeys(keys []SSHHostKey) []SSHHostKey {
	out := make([]SSHHostKey, 0, len(keys))
	seen := map[string]bool{}
	for _, key := range keys {
		if key.FingerprintSHA256 == "" {
			continue
		}
		identity := key.Algorithm + "\x00" + key.FingerprintSHA256
		if seen[identity] {
			continue
		}
		seen[identity] = true
		out = append(out, key)
	}
	return out
}

func sameSSHHostKeys(a, b []SSHHostKey) bool {
	a = normaliseSSHHostKeys(a)
	b = normaliseSSHHostKeys(b)
	if len(a) != len(b) {
		return false
	}
	counts := map[string]int{}
	for _, key := range a {
		counts[key.FingerprintSHA256]++
	}
	for _, key := range b {
		counts[key.FingerprintSHA256]--
		if counts[key.FingerprintSHA256] < 0 {
			return false
		}
	}
	return true
}
