package queries

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GetSystemConfig returns the value for a system_config key, or pgx.ErrNoRows
// if the key does not exist.
func GetSystemConfig(ctx context.Context, pool *pgxpool.Pool, key string) (string, error) {
	var value string
	err := pool.QueryRow(ctx,
		`SELECT value FROM system_config WHERE key = $1`,
		key,
	).Scan(&value)
	if err != nil {
		return "", err
	}
	return value, nil
}

// UpsertSystemConfig inserts or updates a system_config row.
func UpsertSystemConfig(ctx context.Context, pool *pgxpool.Pool, key, value string) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO system_config (key, value, updated_at)
		 VALUES ($1, $2, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		key, value,
	)
	return err
}

// ErrNoRows re-exports pgx.ErrNoRows so callers don't need a pgx import.
var ErrNoRows = pgx.ErrNoRows
