package queries

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MergeTagLayers merges layers of TagPair with last-wins on conflicting keys
// (case-insensitive). Layers should be passed weakest→strongest so the caller's
// most-specific intent wins. Mirrors mergeTagLayers in apps/web/lib/actions/tags.ts.
func MergeTagLayers(layers ...[]TagPair) []TagPair {
	byKey := make(map[string]TagPair)
	order := make([]string, 0)
	for _, layer := range layers {
		for _, p := range layer {
			lk := lower(p.Key)
			if _, seen := byKey[lk]; !seen {
				order = append(order, lk)
			}
			byKey[lk] = p
		}
	}
	out := make([]TagPair, 0, len(order))
	for _, lk := range order {
		out = append(out, byKey[lk])
	}
	return out
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

// GetInstanceDefaultTags reads instance_settings.metadata.defaultTags. Returns nil when
// no defaults are set.
func GetInstanceDefaultTags(ctx context.Context, pool *pgxpool.Pool, instanceID string) ([]TagPair, error) {
	const q = `SELECT COALESCE(metadata, '{}'::jsonb) FROM instance_settings WHERE id = $1`
	var raw []byte
	if err := pool.QueryRow(ctx, q, instanceID).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	var meta struct {
		DefaultTags []TagPair `json:"defaultTags,omitempty"`
	}
	if len(raw) == 0 {
		return nil, nil
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil, nil
	}
	return meta.DefaultTags, nil
}

// upsertTag case-insensitively resolves or inserts a single (org, key, value)
// row in `tags` and returns its id. Mirrors the select-then-insert-then-reselect
// pattern in the TS upsertTag so a concurrent unique-violation never bubbles up.
func upsertTag(ctx context.Context, tx pgx.Tx, instanceID string, pair TagPair) (string, error) {
	const sel = `
		SELECT id FROM tags
		WHERE instance_id = $1
		  AND lower(key) = lower($2)
		  AND lower(value) = lower($3)
		LIMIT 1
	`
	var id string
	err := tx.QueryRow(ctx, sel, instanceID, pair.Key, pair.Value).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	const ins = `
		INSERT INTO tags (id, instance_id, key, value, usage_count)
		VALUES ($1, $2, $3, $4, 0)
		ON CONFLICT DO NOTHING
		RETURNING id
	`
	err = tx.QueryRow(ctx, ins, newCUID(), instanceID, pair.Key, pair.Value).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	if err := tx.QueryRow(ctx, sel, instanceID, pair.Key, pair.Value).Scan(&id); err != nil {
		return "", fmt.Errorf("tag upsert could not resolve id: %w", err)
	}
	return id, nil
}

// AssignTagsToResource upserts each tag and links it to the resource via
// resource_tags. Duplicate assignments are skipped (ON CONFLICT DO NOTHING);
// usage_count only increments on fresh inserts. Mirrors assignTagsToResource
// in apps/web/lib/actions/tags.ts.
func AssignTagsToResource(ctx context.Context, pool *pgxpool.Pool, instanceID, resourceType, resourceID string, pairs []TagPair) error {
	if len(pairs) == 0 {
		return nil
	}
	deduped := MergeTagLayers(pairs)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, p := range deduped {
		tagID, err := upsertTag(ctx, tx, instanceID, p)
		if err != nil {
			return fmt.Errorf("upserting tag %s=%s: %w", p.Key, p.Value, err)
		}
		const insLink = `
			INSERT INTO resource_tags (id, instance_id, resource_id, resource_type, tag_id)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (resource_id, resource_type, tag_id) DO NOTHING
			RETURNING id
		`
		var rtID string
		err = tx.QueryRow(ctx, insLink, newCUID(), instanceID, resourceID, resourceType, tagID).Scan(&rtID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("inserting resource_tag: %w", err)
		}
		if err == nil {
			const bump = `UPDATE tags SET usage_count = usage_count + 1 WHERE id = $1`
			if _, err := tx.Exec(ctx, bump, tagID); err != nil {
				return fmt.Errorf("bumping usage_count: %w", err)
			}
		}
	}
	return tx.Commit(ctx)
}
