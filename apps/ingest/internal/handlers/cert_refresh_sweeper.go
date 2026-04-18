package handlers

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infrawatch/ingest/internal/db/queries"
)

const (
	certRefreshBatchSize  = 50
	certRefreshDialTimout = 10 * time.Second
)

// RunCertRefreshSweeper ticks periodically and re-fetches TLS certificates for
// rows in the certificates table that have a tracked_url set. It refreshes
// status + last_refreshed_at on unchanged certs, inserts a new row and clears
// tracking on the old row when it detects a renewal (different fingerprint on
// the same endpoint), and records a fetch error without altering cert data
// when the endpoint is temporarily unreachable.
func RunCertRefreshSweeper(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("cert refresh sweeper started", "interval", interval)

	for {
		select {
		case <-ctx.Done():
			slog.Info("cert refresh sweeper stopped")
			return
		case <-ticker.C:
			runCertRefreshTick(ctx, pool)
		}
	}
}

func runCertRefreshTick(ctx context.Context, pool *pgxpool.Pool) {
	rows, err := queries.ListCertsDueForUrlRefresh(ctx, pool, certRefreshBatchSize)
	if err != nil {
		slog.Warn("cert refresh: querying due certs", "err", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	slog.Info("cert refresh: refreshing tracked certs", "count", len(rows))
	for _, row := range rows {
		refreshTrackedCert(ctx, pool, row)
	}
}

func refreshTrackedCert(ctx context.Context, pool *pgxpool.Pool, row queries.TrackedCertRow) {
	leaf, chain, err := fetchLeafAndChain(ctx, row.TrackedURL)
	if err != nil {
		slog.Info("cert refresh: fetch failed", "cert_id", row.ID, "url", row.TrackedURL, "err", err)
		if qErr := queries.MarkCertRefreshFailed(ctx, pool, row.ID, truncateError(err.Error())); qErr != nil {
			slog.Warn("cert refresh: mark failed", "cert_id", row.ID, "err", qErr)
		}
		return
	}

	newFingerprint := fingerprintSha256Hex(leaf.Raw)
	newStatus := computeCertStatus(leaf.NotAfter, 30)

	if newFingerprint == row.FingerprintSHA256 {
		// Same cert — just refresh status + timestamps.
		if err := queries.MarkCertRefreshed(ctx, pool, row.ID, newStatus); err != nil {
			slog.Warn("cert refresh: mark refreshed", "cert_id", row.ID, "err", err)
			return
		}
		if newStatus != row.Status && row.Status != "" {
			if evErr := queries.InsertCertificateEvent(ctx, pool,
				row.ID, row.OrgID,
				newStatus, row.Status, newStatus,
				fmt.Sprintf("Certificate status changed from %s to %s", row.Status, newStatus),
				nil,
			); evErr != nil {
				slog.Warn("cert refresh: insert status-change event", "err", evErr)
			}
		}
		evaluateCertExpiryForCert(ctx, pool, row.OrgID, row.ID,
			leaf.Subject.CommonName, leaf.Issuer.CommonName,
			row.Host, row.Port, leaf.NotAfter, newStatus)
		return
	}

	// Fingerprint changed — this is a renewal.
	commonName := leaf.Subject.CommonName
	if commonName == "" {
		commonName = row.Host
	}
	issuer := leaf.Issuer.CommonName
	if issuer == "" {
		issuer = leaf.Issuer.String()
	}
	sans := collectSans(leaf)
	details := buildCertDetailsFromX509(leaf, chain)
	detailsJSON, _ := json.Marshal(details)

	newCertID, err := queries.InsertRenewedTrackedCert(
		ctx, pool,
		row.ID, row.OrgID,
		row.Host, row.Port, row.ServerName,
		commonName, issuer,
		sans,
		leaf.NotBefore, leaf.NotAfter,
		newFingerprint, newStatus, row.TrackedURL,
		row.RefreshIntervalSeconds,
		detailsJSON,
	)
	if err != nil {
		slog.Warn("cert refresh: insert renewed cert", "cert_id", row.ID, "err", err)
		return
	}

	meta, _ := json.Marshal(map[string]string{"newCertificateId": newCertID})
	if evErr := queries.InsertCertificateEvent(ctx, pool,
		row.ID, row.OrgID,
		"renewed", row.Status, "",
		fmt.Sprintf("Certificate renewed: replaced by new fingerprint on %s:%d", row.Host, row.Port),
		meta,
	); evErr != nil {
		slog.Warn("cert refresh: insert renewed event (old cert)", "err", evErr)
	}

	if evErr := queries.InsertCertificateEvent(ctx, pool,
		newCertID, row.OrgID,
		"renewed", "", newStatus,
		fmt.Sprintf("Certificate renewed on %s:%d (CN: %s)", row.Host, row.Port, commonName),
		nil,
	); evErr != nil {
		slog.Warn("cert refresh: insert renewed event (new cert)", "err", evErr)
	}

	if newStatus == "expiring_soon" || newStatus == "expired" {
		if evErr := queries.InsertCertificateEvent(ctx, pool,
			newCertID, row.OrgID,
			newStatus, "", newStatus,
			fmt.Sprintf("Certificate %s: expires %s", newStatus, leaf.NotAfter.Format("2006-01-02")),
			nil,
		); evErr != nil {
			slog.Warn("cert refresh: insert expiry event on renewal", "err", evErr)
		}
	}

	evaluateCertExpiryForCert(ctx, pool, row.OrgID, newCertID,
		commonName, issuer, row.Host, row.Port, leaf.NotAfter, newStatus)

	slog.Info("cert refresh: renewed",
		"old_cert_id", row.ID, "new_cert_id", newCertID,
		"host", row.Host, "port", row.Port, "cn", commonName)
}

// fetchLeafAndChain opens a TLS connection to the trackedUrl and returns the
// peer leaf certificate plus the intermediate chain (everything after the
// leaf).
func fetchLeafAndChain(ctx context.Context, trackedURL string) (*x509.Certificate, []*x509.Certificate, error) {
	host, port, serverName, err := parseTrackedURL(trackedURL)
	if err != nil {
		return nil, nil, err
	}

	dialer := &net.Dialer{Timeout: certRefreshDialTimout}
	rawConn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return nil, nil, fmt.Errorf("tcp dial: %w", err)
	}
	defer rawConn.Close()

	tlsConn := tls.Client(rawConn, &tls.Config{
		ServerName:         serverName,
		InsecureSkipVerify: true, // we record the cert regardless of trust chain
	})
	defer tlsConn.Close()

	handshakeCtx, cancel := context.WithTimeout(ctx, certRefreshDialTimout)
	defer cancel()
	if err := tlsConn.HandshakeContext(handshakeCtx); err != nil {
		return nil, nil, fmt.Errorf("tls handshake: %w", err)
	}

	peers := tlsConn.ConnectionState().PeerCertificates
	if len(peers) == 0 {
		return nil, nil, fmt.Errorf("no peer certificates")
	}
	leaf := peers[0]
	chain := peers[1:]
	return leaf, chain, nil
}

// parseTrackedURL turns a user-supplied URL into host/port/serverName for the
// TLS dial. Supports explicit schemes (https, tls, ldaps, smtps, imaps, pop3s,
// etc.) and bare "host:port" forms.
func parseTrackedURL(raw string) (host string, port int, serverName string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", 0, "", fmt.Errorf("empty url")
	}

	if !strings.Contains(raw, "://") {
		// bare host or host:port
		return splitHostPort(raw, 443)
	}

	u, perr := url.Parse(raw)
	if perr != nil {
		return "", 0, "", fmt.Errorf("parse url: %w", perr)
	}
	if u.Hostname() == "" {
		return "", 0, "", fmt.Errorf("url has no host")
	}

	p := u.Port()
	if p == "" {
		return u.Hostname(), defaultPortForScheme(u.Scheme), u.Hostname(), nil
	}
	parsedPort, perr := strconv.Atoi(p)
	if perr != nil {
		return "", 0, "", fmt.Errorf("invalid port: %w", perr)
	}
	return u.Hostname(), parsedPort, u.Hostname(), nil
}

func splitHostPort(s string, defaultPort int) (string, int, string, error) {
	if !strings.Contains(s, ":") {
		return s, defaultPort, s, nil
	}
	h, p, err := net.SplitHostPort(s)
	if err != nil {
		return "", 0, "", fmt.Errorf("split host:port: %w", err)
	}
	parsedPort, err := strconv.Atoi(p)
	if err != nil {
		return "", 0, "", fmt.Errorf("invalid port: %w", err)
	}
	return h, parsedPort, h, nil
}

func defaultPortForScheme(scheme string) int {
	switch strings.ToLower(scheme) {
	case "https":
		return 443
	case "ldaps":
		return 636
	case "smtps":
		return 465
	case "imaps":
		return 993
	case "pop3s":
		return 995
	case "ftps":
		return 990
	default:
		return 443
	}
}

func fingerprintSha256Hex(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}

func collectSans(c *x509.Certificate) []string {
	var out []string
	for _, name := range c.DNSNames {
		if name != "" {
			out = append(out, name)
		}
	}
	for _, ip := range c.IPAddresses {
		out = append(out, ip.String())
	}
	for _, email := range c.EmailAddresses {
		out = append(out, email)
	}
	for _, uri := range c.URIs {
		out = append(out, uri.String())
	}
	return out
}

func buildCertDetailsFromX509(leaf *x509.Certificate, chain []*x509.Certificate) certDetails {
	details := certDetails{
		Subject:            leaf.Subject.String(),
		Issuer:             leaf.Issuer.String(),
		SerialNumber:       leaf.SerialNumber.String(),
		SignatureAlgorithm: leaf.SignatureAlgorithm.String(),
		KeyAlgorithm:       leaf.PublicKeyAlgorithm.String(),
		IsSelfSigned:       leaf.Subject.String() == leaf.Issuer.String(),
	}
	for _, c := range chain {
		details.Chain = append(details.Chain, certChainEntry{
			Subject:           c.Subject.String(),
			Issuer:            c.Issuer.String(),
			NotBefore:         c.NotBefore,
			NotAfter:          c.NotAfter,
			FingerprintSHA256: fingerprintSha256Hex(c.Raw),
		})
	}
	return details
}

func truncateError(msg string) string {
	const maxLen = 500
	if len(msg) <= maxLen {
		return msg
	}
	return msg[:maxLen] + "…"
}
