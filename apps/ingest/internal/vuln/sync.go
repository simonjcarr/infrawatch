package vuln

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ulikunitz/xz"
)

type SyncConfig struct {
	Enabled        bool
	Interval       time.Duration
	SyncOnStartup  bool
	RequestTimeout time.Duration
	NVDAPIKey      string
	NVDDaysBack    int
	CISAURL        string
	DebianURL      string
	UbuntuOSVURL   string
	AlpineBaseURL  string
	AlpineReleases []string
	RedHatURL      string
}

func DefaultSyncConfig() SyncConfig {
	return SyncConfig{
		Enabled:        true,
		Interval:       6 * time.Hour,
		SyncOnStartup:  true,
		RequestTimeout: 45 * time.Second,
		NVDDaysBack:    14,
		CISAURL:        "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
		DebianURL:      "https://security-tracker.debian.org/tracker/data/json",
		UbuntuOSVURL:   "https://security-metadata.canonical.com/osv/osv-all.tar.xz",
		AlpineBaseURL:  "https://secdb.alpinelinux.org",
		AlpineReleases: []string{"v3.18", "v3.19", "v3.20", "v3.21", "v3.22", "v3.23"},
		RedHatURL:      "https://access.redhat.com/hydra/rest/securitydata/cve.json",
	}
}

func RunSyncer(ctx context.Context, pool *pgxpool.Pool, cfg SyncConfig) {
	if !cfg.Enabled {
		slog.Info("vulnerability sync disabled")
		return
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 6 * time.Hour
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 45 * time.Second
	}

	run := func() {
		if err := SyncOnce(ctx, pool, cfg); err != nil {
			slog.Warn("vulnerability sync failed", "err", err)
			return
		}
		if err := MatchAllHosts(ctx, pool); err != nil {
			slog.Warn("vulnerability matching after sync failed", "err", err)
		}
	}
	if cfg.SyncOnStartup {
		go run()
	}

	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func SyncOnce(ctx context.Context, pool *pgxpool.Pool, cfg SyncConfig) error {
	client := &http.Client{Timeout: cfg.RequestTimeout}
	sources := []func(context.Context, *pgxpool.Pool, *http.Client, SyncConfig) error{
		syncCISA,
		syncDebian,
		syncUbuntuOSV,
		syncAlpine,
		syncNVD,
		syncRedHat,
	}
	for _, source := range sources {
		if err := source(ctx, pool, client, cfg); err != nil {
			slog.Warn("vulnerability source sync failed", "err", err)
		}
	}
	return nil
}

func syncCISA(ctx context.Context, pool *pgxpool.Pool, client *http.Client, cfg SyncConfig) error {
	if cfg.CISAURL == "" {
		return nil
	}
	sourceID := "cisa-kev"
	body, meta, err := fetchSource(ctx, pool, client, sourceID, cfg.CISAURL)
	if err != nil || body == nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}
	entries, err := ParseCISAKEV(bytes.NewReader(body))
	if err != nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}
	for _, entry := range entries {
		if err := UpsertCVE(ctx, pool, CVERecord{
			CVEID:             entry.CVEID,
			Severity:          SeverityUnknown,
			KnownExploited:    true,
			KEVDueDate:        entry.DueDate,
			KEVVendorProject:  entry.VendorProject,
			KEVProduct:        entry.Product,
			KEVRequiredAction: entry.RequiredAction,
			Source:            sourceID,
		}); err != nil {
			return markSourceResult(ctx, pool, sourceID, meta, len(entries), err)
		}
	}
	return markSourceResult(ctx, pool, sourceID, meta, len(entries), nil)
}

func syncDebian(ctx context.Context, pool *pgxpool.Pool, client *http.Client, cfg SyncConfig) error {
	if cfg.DebianURL == "" {
		return nil
	}
	sourceID := "debian-tracker"
	body, meta, err := fetchSource(ctx, pool, client, sourceID, cfg.DebianURL)
	if err != nil || body == nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}
	cves, affected, err := ParseDebianTracker(bytes.NewReader(body))
	if err != nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}
	if err := persistRecords(ctx, pool, cves, affected); err != nil {
		return markSourceResult(ctx, pool, sourceID, meta, len(cves)+len(affected), err)
	}
	return markSourceResult(ctx, pool, sourceID, meta, len(cves)+len(affected), nil)
}

func syncUbuntuOSV(ctx context.Context, pool *pgxpool.Pool, client *http.Client, cfg SyncConfig) error {
	if cfg.UbuntuOSVURL == "" {
		return nil
	}
	sourceID := "ubuntu-osv"
	body, meta, err := fetchSource(ctx, pool, client, sourceID, cfg.UbuntuOSVURL)
	if err != nil || body == nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}

	reader, err := xz.NewReader(bytes.NewReader(body))
	if err != nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}
	tarReader := tar.NewReader(reader)
	count := 0
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return markSourceResult(ctx, pool, sourceID, meta, count, err)
		}
		if header.FileInfo().IsDir() || !strings.HasSuffix(header.Name, ".json") || !strings.Contains(header.Name, "CVE-") {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(tarReader, 10*1024*1024))
		if err != nil {
			return markSourceResult(ctx, pool, sourceID, meta, count, err)
		}
		cves, affected, err := ParseUbuntuOSVDocument(bytes.NewReader(data))
		if err != nil {
			return markSourceResult(ctx, pool, sourceID, meta, count, err)
		}
		if err := persistRecords(ctx, pool, cves, affected); err != nil {
			return markSourceResult(ctx, pool, sourceID, meta, count, err)
		}
		count += len(cves) + len(affected)
	}
	return markSourceResult(ctx, pool, sourceID, meta, count, nil)
}

func syncAlpine(ctx context.Context, pool *pgxpool.Pool, client *http.Client, cfg SyncConfig) error {
	if cfg.AlpineBaseURL == "" || len(cfg.AlpineReleases) == 0 {
		return nil
	}
	for _, release := range cfg.AlpineReleases {
		for _, repo := range []string{"main", "community"} {
			sourceID := fmt.Sprintf("alpine-secdb-%s-%s", release, repo)
			feedURL := strings.TrimRight(cfg.AlpineBaseURL, "/") + "/" + release + "/" + repo + ".json"
			body, meta, err := fetchSource(ctx, pool, client, sourceID, feedURL)
			if err != nil || body == nil {
				if markErr := markSourceResult(ctx, pool, sourceID, meta, 0, err); markErr != nil {
					return markErr
				}
				continue
			}
			cves, affected, err := ParseAlpineSecDB(bytes.NewReader(body), release, repo)
			if err != nil {
				if markErr := markSourceResult(ctx, pool, sourceID, meta, 0, err); markErr != nil {
					return markErr
				}
				continue
			}
			if err := persistRecords(ctx, pool, cves, affected); err != nil {
				if markErr := markSourceResult(ctx, pool, sourceID, meta, len(cves)+len(affected), err); markErr != nil {
					return markErr
				}
				continue
			}
			if err := markSourceResult(ctx, pool, sourceID, meta, len(cves)+len(affected), nil); err != nil {
				return err
			}
		}
	}
	return nil
}

func syncNVD(ctx context.Context, pool *pgxpool.Pool, client *http.Client, cfg SyncConfig) error {
	sourceID := "nvd"
	const sourceURL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
	if err := MarkSourceAttempt(ctx, pool, sourceID, sourceURL); err != nil {
		return err
	}
	state, err := GetSourceState(ctx, pool, sourceID)
	if err != nil {
		return err
	}
	start := time.Now().UTC().AddDate(0, 0, -cfg.NVDDaysBack)
	if state.LastSuccessAt != nil {
		start = state.LastSuccessAt.UTC().Add(-time.Hour)
	}
	end := time.Now().UTC()
	if end.Sub(start) > 120*24*time.Hour {
		start = end.Add(-120 * 24 * time.Hour)
	}

	base, _ := url.Parse(sourceURL)
	values := base.Query()
	values.Set("lastModStartDate", nvdTime(start))
	values.Set("lastModEndDate", nvdTime(end))
	values.Set("resultsPerPage", "2000")
	total := 1
	startIndex := 0
	count := 0
	for startIndex < total {
		values.Set("startIndex", fmt.Sprintf("%d", startIndex))
		base.RawQuery = values.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
		if err != nil {
			return err
		}
		if cfg.NVDAPIKey != "" {
			req.Header.Set("apiKey", cfg.NVDAPIKey)
		}
		resp, err := client.Do(req)
		if err != nil {
			_ = MarkSourceError(ctx, pool, sourceID, err)
			return err
		}
		data, readErr := readResponse(resp)
		if readErr != nil {
			_ = MarkSourceError(ctx, pool, sourceID, readErr)
			return readErr
		}
		cves, pageTotal, err := ParseNVDAPI(bytes.NewReader(data))
		if err != nil {
			_ = MarkSourceError(ctx, pool, sourceID, err)
			return err
		}
		total = pageTotal
		for _, cve := range cves {
			if err := UpsertCVE(ctx, pool, cve); err != nil {
				_ = MarkSourceError(ctx, pool, sourceID, err)
				return err
			}
		}
		count += len(cves)
		startIndex += 2000
		if cfg.NVDAPIKey == "" {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(6 * time.Second):
			}
		}
	}
	return MarkSourceSuccess(ctx, pool, sourceID, "", "", count, encodeMetadata(map[string]string{
		"lastModStartDate": nvdTime(start),
		"lastModEndDate":   nvdTime(end),
	}))
}

func syncRedHat(ctx context.Context, pool *pgxpool.Pool, client *http.Client, cfg SyncConfig) error {
	if cfg.RedHatURL == "" {
		return nil
	}
	sourceID := "redhat-security-data"
	body, meta, err := fetchSource(ctx, pool, client, sourceID, cfg.RedHatURL)
	if err != nil || body == nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}
	cves, affected, err := parseRedHatCVEList(bytes.NewReader(body))
	if err != nil {
		return markSourceResult(ctx, pool, sourceID, meta, 0, err)
	}
	if err := persistRecords(ctx, pool, cves, affected); err != nil {
		return markSourceResult(ctx, pool, sourceID, meta, len(cves)+len(affected), err)
	}
	return markSourceResult(ctx, pool, sourceID, meta, len(cves)+len(affected), nil)
}

func persistRecords(ctx context.Context, pool *pgxpool.Pool, cves []CVERecord, affected []AffectedPackage) error {
	for _, cve := range cves {
		if cve.Severity == "" {
			cve.Severity = SeverityUnknown
		}
		if err := UpsertCVE(ctx, pool, cve); err != nil {
			return err
		}
	}
	for _, row := range affected {
		if row.Severity == "" {
			row.Severity = SeverityUnknown
		}
		if _, err := UpsertAffectedPackage(ctx, pool, row); err != nil {
			return err
		}
	}
	return nil
}

type fetchMeta struct {
	ETag         string
	LastModified string
	SHA256       string
	NotModified  bool
}

func fetchSource(ctx context.Context, pool *pgxpool.Pool, client *http.Client, sourceID, sourceURL string) ([]byte, fetchMeta, error) {
	if err := MarkSourceAttempt(ctx, pool, sourceID, sourceURL); err != nil {
		return nil, fetchMeta{}, err
	}
	state, err := GetSourceState(ctx, pool, sourceID)
	if err != nil {
		return nil, fetchMeta{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, fetchMeta{}, err
	}
	if state.ETag != "" {
		req.Header.Set("If-None-Match", state.ETag)
	}
	if state.LastModified != "" {
		req.Header.Set("If-Modified-Since", state.LastModified)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fetchMeta{}, err
	}
	meta := fetchMeta{
		ETag:         resp.Header.Get("ETag"),
		LastModified: resp.Header.Get("Last-Modified"),
	}
	if resp.StatusCode == http.StatusNotModified {
		_ = resp.Body.Close()
		meta.NotModified = true
		return nil, meta, nil
	}
	body, err := readResponse(resp)
	if err != nil {
		return nil, meta, err
	}
	hash := sha256.Sum256(body)
	meta.SHA256 = hex.EncodeToString(hash[:])
	if state.SHA256 != "" && meta.SHA256 == state.SHA256 {
		meta.NotModified = true
		return nil, meta, nil
	}
	return body, meta, nil
}

func readResponse(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 250*1024*1024))
}

func markSourceResult(ctx context.Context, pool *pgxpool.Pool, sourceID string, meta fetchMeta, records int, err error) error {
	if err != nil {
		return MarkSourceError(ctx, pool, sourceID, err)
	}
	if meta.NotModified {
		return MarkSourceSuccess(ctx, pool, sourceID, meta.ETag, meta.LastModified, 0, sourceMetadata(meta, true))
	}
	return MarkSourceSuccess(ctx, pool, sourceID, meta.ETag, meta.LastModified, records, sourceMetadata(meta, false))
}

func nvdTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func sourceMetadata(meta fetchMeta, notModified bool) []byte {
	if meta.SHA256 == "" {
		return nil
	}
	values := map[string]any{"sha256": meta.SHA256}
	if notModified {
		values["notModified"] = true
	}
	return encodeMetadata(values)
}
