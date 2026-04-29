package vuln

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"strings"
	"time"

	ctcrypto "github.com/carrtech-dev/ct-ops/ingest/internal/crypto"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const NVDAPIKeyConfigKey = "vulnerability_nvd_api_key"

func GetStoredNVDAPIKey(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var encrypted string
	err := pool.QueryRow(ctx, `SELECT value FROM system_config WHERE key = $1`, NVDAPIKeyConfigKey).Scan(&encrypted)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	plaintext, err := ctcrypto.Decrypt(encrypted)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func UpsertCVE(ctx context.Context, pool *pgxpool.Pool, record CVERecord) error {
	const q = `
		INSERT INTO vulnerability_cves (
			cve_id, title, description, severity, cvss_score, published_at, modified_at,
			rejected, known_exploited, kev_due_date, kev_vendor_project, kev_product,
			kev_required_action, source, metadata, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
		ON CONFLICT (cve_id) DO UPDATE SET
			title = COALESCE(EXCLUDED.title, vulnerability_cves.title),
			description = COALESCE(EXCLUDED.description, vulnerability_cves.description),
			severity = CASE
				WHEN EXCLUDED.severity <> 'unknown' THEN EXCLUDED.severity
				ELSE vulnerability_cves.severity
			END,
			cvss_score = COALESCE(EXCLUDED.cvss_score, vulnerability_cves.cvss_score),
			published_at = COALESCE(EXCLUDED.published_at, vulnerability_cves.published_at),
			modified_at = COALESCE(EXCLUDED.modified_at, vulnerability_cves.modified_at),
			rejected = EXCLUDED.rejected OR vulnerability_cves.rejected,
			known_exploited = EXCLUDED.known_exploited OR vulnerability_cves.known_exploited,
			kev_due_date = COALESCE(EXCLUDED.kev_due_date, vulnerability_cves.kev_due_date),
			kev_vendor_project = COALESCE(EXCLUDED.kev_vendor_project, vulnerability_cves.kev_vendor_project),
			kev_product = COALESCE(EXCLUDED.kev_product, vulnerability_cves.kev_product),
			kev_required_action = COALESCE(EXCLUDED.kev_required_action, vulnerability_cves.kev_required_action),
			source = COALESCE(EXCLUDED.source, vulnerability_cves.source),
			metadata = COALESCE(EXCLUDED.metadata, vulnerability_cves.metadata),
			updated_at = NOW()
	`
	_, err := pool.Exec(ctx, q,
		record.CVEID,
		nullable(record.Title),
		nullable(record.Description),
		string(record.Severity),
		record.CVSSScore,
		record.PublishedAt,
		record.ModifiedAt,
		record.Rejected,
		record.KnownExploited,
		record.KEVDueDate,
		nullable(record.KEVVendorProject),
		nullable(record.KEVProduct),
		nullable(record.KEVRequiredAction),
		nullable(record.Source),
		jsonOrNil(record.MetadataJSON),
	)
	return err
}

func UpsertAffectedPackage(ctx context.Context, pool *pgxpool.Pool, row AffectedPackage) (string, error) {
	const findQ = `
		SELECT id
		FROM vulnerability_affected_packages
		WHERE source = $1
		  AND cve_id = $2
		  AND distro_id = $3
		  AND distro_version_id IS NOT DISTINCT FROM $4
		  AND distro_codename IS NOT DISTINCT FROM $5
		  AND package_name = $6
		  AND fixed_version IS NOT DISTINCT FROM $7
		  AND repository IS NOT DISTINCT FROM $8
		LIMIT 1
	`
	var existing string
	err := pool.QueryRow(ctx, findQ,
		row.Source, row.CVEID, row.DistroID,
		nullable(row.DistroVersionID), nullable(row.DistroCodename),
		row.PackageName, nullable(row.FixedVersion), nullable(row.Repository),
	).Scan(&existing)
	if err == nil {
		const updateQ = `
			UPDATE vulnerability_affected_packages
			SET source_package_name = COALESCE($2, source_package_name),
			    affected_versions = COALESCE($3::jsonb, affected_versions),
			    severity = CASE WHEN $4 <> 'unknown' THEN $4 ELSE severity END,
			    package_state = COALESCE($5, package_state),
			    metadata = COALESCE($6::jsonb, metadata),
			    updated_at = NOW()
			WHERE id = $1
		`
		_, updateErr := pool.Exec(ctx, updateQ,
			existing,
			nullable(row.SourcePackageName),
			jsonStringArrayOrNil(row.AffectedVersions),
			string(row.Severity),
			nullable(row.PackageState),
			jsonOrNil(row.MetadataJSON),
		)
		return existing, updateErr
	}
	if err != pgx.ErrNoRows {
		return "", err
	}

	id := newCUID()
	const insertQ = `
		INSERT INTO vulnerability_affected_packages (
			id, cve_id, source, distro_id, distro_version_id, distro_codename,
			package_name, source_package_name, fixed_version, affected_versions,
			repository, severity, package_state, metadata, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,NOW(),NOW())
	`
	_, err = pool.Exec(ctx, insertQ,
		id,
		row.CVEID,
		row.Source,
		row.DistroID,
		nullable(row.DistroVersionID),
		nullable(row.DistroCodename),
		row.PackageName,
		nullable(row.SourcePackageName),
		nullable(row.FixedVersion),
		jsonStringArrayOrNil(row.AffectedVersions),
		nullable(row.Repository),
		string(row.Severity),
		nullable(row.PackageState),
		jsonOrNil(row.MetadataJSON),
	)
	return id, err
}

func MarkSourceAttempt(ctx context.Context, pool *pgxpool.Pool, id, sourceURL string) error {
	const q = `
		INSERT INTO vulnerability_sources (id, status, last_attempt_at, metadata, created_at, updated_at)
		VALUES ($1, 'pending', NOW(), jsonb_build_object('url', $2::text), NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			status = 'pending',
			last_attempt_at = NOW(),
			last_error = NULL,
			metadata = COALESCE(vulnerability_sources.metadata, '{}'::jsonb) || jsonb_build_object('url', $2::text),
			updated_at = NOW()
	`
	_, err := pool.Exec(ctx, q, id, sourceURL)
	return err
}

func MarkSourceSuccess(ctx context.Context, pool *pgxpool.Pool, id, etag, lastModified string, records int, metadata []byte) error {
	const q = `
		INSERT INTO vulnerability_sources (
			id, status, etag, last_modified, last_attempt_at, last_success_at,
			records_upserted, metadata, created_at, updated_at
		)
		VALUES ($1,'success',$2,$3,NOW(),NOW(),$4,$5::jsonb,NOW(),NOW())
		ON CONFLICT (id) DO UPDATE SET
			status = 'success',
			etag = COALESCE($2, vulnerability_sources.etag),
			last_modified = COALESCE($3, vulnerability_sources.last_modified),
			last_attempt_at = NOW(),
			last_success_at = NOW(),
			last_error = NULL,
			records_upserted = $4,
			metadata = COALESCE(vulnerability_sources.metadata, '{}'::jsonb) || COALESCE($5::jsonb, '{}'::jsonb),
			updated_at = NOW()
	`
	_, err := pool.Exec(ctx, q, id, nullable(etag), nullable(lastModified), records, jsonOrNil(metadata))
	return err
}

func MarkSourceError(ctx context.Context, pool *pgxpool.Pool, id string, syncErr error) error {
	const q = `
		INSERT INTO vulnerability_sources (id, status, last_attempt_at, last_error, created_at, updated_at)
		VALUES ($1, 'error', NOW(), $2, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			status = 'error',
			last_attempt_at = NOW(),
			last_error = $2,
			updated_at = NOW()
	`
	_, err := pool.Exec(ctx, q, id, syncErr.Error())
	return err
}

type SourceState struct {
	ETag          string
	LastModified  string
	SHA256        string
	LastSuccessAt *time.Time
}

func GetSourceState(ctx context.Context, pool *pgxpool.Pool, id string) (SourceState, error) {
	const q = `
		SELECT COALESCE(etag, ''),
		       COALESCE(last_modified, ''),
		       COALESCE(metadata->>'sha256', ''),
		       last_success_at
		FROM vulnerability_sources
		WHERE id = $1
	`
	var state SourceState
	err := pool.QueryRow(ctx, q, id).Scan(&state.ETag, &state.LastModified, &state.SHA256, &state.LastSuccessAt)
	if err == pgx.ErrNoRows {
		return SourceState{}, nil
	}
	return state, err
}

func MatchHost(ctx context.Context, pool *pgxpool.Pool, hostID string) error {
	pkgs, err := loadHostPackages(ctx, pool, hostID)
	if err != nil {
		return err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE host_vulnerability_findings
		SET status = 'resolved',
		    resolved_at = NOW(),
		    updated_at = NOW()
		WHERE host_id = $1
		  AND status = 'open'
	`, hostID); err != nil {
		return err
	}

	for _, pkg := range pkgs {
		candidates, err := loadAffectedCandidates(ctx, pool, pkg)
		if err != nil {
			return err
		}
		for _, affected := range candidates {
			matched, reason := MatchPackage(pkg, affected)
			if !matched {
				continue
			}
			if err := upsertFinding(ctx, tx, pkg, affected, reason); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func MatchAllHosts(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT host_id
		FROM software_packages
		WHERE deleted_at IS NULL
		  AND removed_at IS NULL
		  AND source IN ('dpkg', 'rpm', 'apk')
		  AND COALESCE(distro_id, '') <> ''
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var hostID string
		if err := rows.Scan(&hostID); err != nil {
			return err
		}
		if err := MatchHost(ctx, pool, hostID); err != nil {
			return err
		}
	}
	return rows.Err()
}

func loadHostPackages(ctx context.Context, pool *pgxpool.Pool, hostID string) ([]InventoryPackage, error) {
	const q = `
		SELECT id, organisation_id, host_id, name, version, source,
		       COALESCE(distro_id, ''), COALESCE(distro_version_id, ''),
		       COALESCE(distro_codename, ''), COALESCE(source_name, ''),
		       COALESCE(source_version, ''), COALESCE(repository, ''),
		       COALESCE(distro_id_like, '[]'::jsonb)::text
		FROM software_packages
		WHERE host_id = $1
		  AND deleted_at IS NULL
		  AND removed_at IS NULL
	`
	rows, err := pool.Query(ctx, q, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pkgs []InventoryPackage
	for rows.Next() {
		var pkg InventoryPackage
		var distroIDLikeJSON string
		if err := rows.Scan(
			&pkg.ID, &pkg.OrganisationID, &pkg.HostID, &pkg.Name, &pkg.Version, &pkg.Source,
			&pkg.DistroID, &pkg.DistroVersionID, &pkg.DistroCodename,
			&pkg.SourceName, &pkg.SourceVersion, &pkg.Repository, &distroIDLikeJSON,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(distroIDLikeJSON), &pkg.DistroIDLike)
		pkgs = append(pkgs, pkg)
	}
	return pkgs, rows.Err()
}

func loadAffectedCandidates(ctx context.Context, pool *pgxpool.Pool, pkg InventoryPackage) ([]AffectedPackage, error) {
	nameCandidates := []string{pkg.Name}
	if pkg.SourceName != "" && pkg.SourceName != pkg.Name {
		nameCandidates = append(nameCandidates, pkg.SourceName)
	}
	distroCandidates := affectedDistroCandidates(pkg)
	majorVersion := majorRHELDistroVersion(pkg)
	rows, err := pool.Query(ctx, `
		SELECT vap.id, vap.cve_id, vap.source, vap.distro_id,
		       COALESCE(vap.distro_version_id, ''), COALESCE(vap.distro_codename, ''),
		       vap.package_name, COALESCE(vap.source_package_name, ''),
		       COALESCE(vap.fixed_version, ''), COALESCE(vap.affected_versions, '[]'::jsonb)::text,
		       COALESCE(vap.repository, ''), vap.severity, COALESCE(vap.package_state, '')
		FROM vulnerability_affected_packages vap
		WHERE vap.distro_id = ANY($1::text[])
		  AND (vap.distro_version_id IS NULL OR vap.distro_version_id = $2 OR ($3 <> '' AND vap.distro_version_id = $3))
		  AND (vap.distro_codename IS NULL OR vap.distro_codename = $4)
		  AND vap.package_name = ANY($5::text[])
	`, distroCandidates, pkg.DistroVersionID, majorVersion, pkg.DistroCodename, nameCandidates)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AffectedPackage
	for rows.Next() {
		var row AffectedPackage
		var affectedVersionsJSON string
		if err := rows.Scan(
			&row.ID, &row.CVEID, &row.Source, &row.DistroID,
			&row.DistroVersionID, &row.DistroCodename, &row.PackageName,
			&row.SourcePackageName, &row.FixedVersion, &affectedVersionsJSON,
			&row.Repository, &row.Severity, &row.PackageState,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(affectedVersionsJSON), &row.AffectedVersions)
		out = append(out, row)
	}
	return out, rows.Err()
}

func affectedDistroCandidates(pkg InventoryPackage) []string {
	candidates := []string{pkg.DistroID}
	if pkg.Source == "rpm" && isRHELCompatibleDistro(pkg) && !strings.EqualFold(pkg.DistroID, "rhel") {
		candidates = append(candidates, "rhel")
	}
	return candidates
}

func majorRHELDistroVersion(pkg InventoryPackage) string {
	if pkg.Source != "rpm" || !isRHELCompatibleDistro(pkg) || pkg.DistroVersionID == "" {
		return ""
	}
	if idx := strings.Index(pkg.DistroVersionID, "."); idx > 0 {
		return pkg.DistroVersionID[:idx]
	}
	return ""
}

type findingTx interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func upsertFinding(ctx context.Context, tx findingTx, pkg InventoryPackage, affected AffectedPackage, reason string) error {
	const q = `
		WITH cve AS (
			SELECT severity, cvss_score, known_exploited
			FROM vulnerability_cves
			WHERE cve_id = $5
		)
		INSERT INTO host_vulnerability_findings (
			id, organisation_id, host_id, software_package_id, cve_id, affected_package_id,
			status, package_name, installed_version, fixed_version, source, severity,
			cvss_score, known_exploited, confidence, match_reason,
			first_seen_at, last_seen_at, resolved_at,
			metadata, created_at, updated_at
		)
		SELECT
			$1, $2, $3, $4, $5, $6,
			'open', $7, $8, $9, $10,
			COALESCE(NULLIF((SELECT severity FROM cve), 'unknown'), $11),
			(SELECT cvss_score FROM cve),
			COALESCE((SELECT known_exploited FROM cve), false),
			$12, $13,
			NOW(), NOW(), NULL,
			$14::jsonb, NOW(), NOW()
		ON CONFLICT (organisation_id, host_id, software_package_id, cve_id)
		DO UPDATE SET
			affected_package_id = EXCLUDED.affected_package_id,
			status = 'open',
			package_name = EXCLUDED.package_name,
			installed_version = EXCLUDED.installed_version,
			fixed_version = EXCLUDED.fixed_version,
			source = EXCLUDED.source,
			severity = EXCLUDED.severity,
			cvss_score = EXCLUDED.cvss_score,
			known_exploited = EXCLUDED.known_exploited,
			confidence = EXCLUDED.confidence,
			match_reason = EXCLUDED.match_reason,
			last_seen_at = NOW(),
			resolved_at = NULL,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`
	_, err := tx.Exec(ctx, q,
		newCUID(),
		pkg.OrganisationID,
		pkg.HostID,
		pkg.ID,
		affected.CVEID,
		nullable(affected.ID),
		pkg.Name,
		pkg.Version,
		nullable(affected.FixedVersion),
		pkg.Source,
		string(affected.Severity),
		string(findingConfidenceForAffected(affected)),
		reason,
		jsonOrNil(encodeMetadata(map[string]string{
			"confidence": string(findingConfidenceForAffected(affected)),
			"reason":     reason,
		})),
	)
	return err
}

func findingConfidenceForAffected(affected AffectedPackage) FindingConfidence {
	if affected.PackageState == "probable" {
		return FindingConfidenceProbable
	}
	return FindingConfidenceConfirmed
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func jsonOrNil(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}

func jsonStringArrayOrNil(values []string) any {
	if len(values) == 0 {
		return nil
	}
	b, err := json.Marshal(values)
	if err != nil {
		return nil
	}
	return string(b)
}

func newCUID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	for i, b := range buf {
		buf[i] = chars[int(b)%len(chars)]
	}
	return string(buf)
}
