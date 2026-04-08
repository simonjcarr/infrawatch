package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infrawatch/ingest/internal/db/queries"
)

// certificateReport matches the JSON produced by the agent's certificate check.
type certificateReport struct {
	Host              string            `json:"host"`
	Port              int               `json:"port"`
	ServerName        string            `json:"server_name"`
	CommonName        string            `json:"common_name"`
	Subject           string            `json:"subject"`
	Issuer            string            `json:"issuer"`
	SANs              []string          `json:"sans"`
	NotBefore         time.Time         `json:"not_before"`
	NotAfter          time.Time         `json:"not_after"`
	FingerprintSHA256 string            `json:"fingerprint_sha256"`
	SerialNumber      string            `json:"serial_number"`
	SignatureAlgo     string            `json:"signature_algorithm"`
	KeyAlgo           string            `json:"key_algorithm"`
	IsSelfSigned      bool              `json:"is_self_signed"`
	Chain             []certChainEntry  `json:"chain"`
	Error             string            `json:"error,omitempty"`
}

type certChainEntry struct {
	Subject           string    `json:"subject"`
	Issuer            string    `json:"issuer"`
	NotBefore         time.Time `json:"not_before"`
	NotAfter          time.Time `json:"not_after"`
	FingerprintSHA256 string    `json:"fingerprint_sha256"`
}

// certDetails is the JSONB stored in certificates.details.
type certDetails struct {
	Subject            string            `json:"subject"`
	Issuer             string            `json:"issuer"`
	SerialNumber       string            `json:"serialNumber"`
	SignatureAlgorithm string            `json:"signatureAlgorithm"`
	KeyAlgorithm       string            `json:"keyAlgorithm"`
	IsSelfSigned       bool              `json:"isSelfSigned"`
	Chain              []certChainEntry  `json:"chain"`
}

// computeCertStatus derives the certificate status from its expiry and a warning window.
func computeCertStatus(notAfter time.Time, warnDays int) string {
	now := time.Now()
	if now.After(notAfter) {
		return "expired"
	}
	warnDate := now.Add(time.Duration(warnDays) * 24 * time.Hour)
	if notAfter.Before(warnDate) {
		return "expiring_soon"
	}
	return "valid"
}

// persistCertificateResult upserts a certificate from a check result output.
func persistCertificateResult(
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID, hostID, checkID, output string,
) {
	var report certificateReport
	if err := json.Unmarshal([]byte(output), &report); err != nil {
		slog.Warn("cert: unmarshal report", "check_id", checkID, "err", err)
		return
	}

	// If the agent reported an error (e.g. TLS dial failed), no cert to persist.
	if report.FingerprintSHA256 == "" {
		slog.Debug("cert: no fingerprint in report, skipping persistence",
			"check_id", checkID, "error_in_report", report.Error)
		return
	}

	status := computeCertStatus(report.NotAfter, 30)

	details := certDetails{
		Subject:            report.Subject,
		Issuer:             report.Issuer,
		SerialNumber:       report.SerialNumber,
		SignatureAlgorithm: report.SignatureAlgo,
		KeyAlgorithm:       report.KeyAlgo,
		IsSelfSigned:       report.IsSelfSigned,
		Chain:              report.Chain,
	}
	detailsJSON, _ := json.Marshal(details)

	// Detect renewal: find existing certs for same endpoint that have a DIFFERENT fingerprint.
	existingCerts, err := queries.FindCertsForEndpoint(ctx, pool, orgID, report.Host, report.Port, report.ServerName)
	if err != nil {
		slog.Warn("cert: finding existing certs for endpoint", "err", err)
	}

	certID, previousStatus, wasInsert, err := queries.UpsertCertificate(
		ctx, pool,
		orgID, hostID, checkID,
		report.Host, report.Port, report.ServerName,
		report.CommonName, report.Issuer,
		report.SANs,
		report.NotBefore, report.NotAfter,
		report.FingerprintSHA256, status,
		detailsJSON,
	)
	if err != nil {
		slog.Warn("cert: upsert certificate", "check_id", checkID, "err", err)
		return
	}

	if wasInsert {
		// Check if this is a renewal (same endpoint, different fingerprint already exists).
		isRenewal := false
		for _, existing := range existingCerts {
			// existingCerts were found BEFORE the upsert, so if any exist they have
			// a different fingerprint (UpsertCertificate found no match by the natural key).
			if existing.ID != certID {
				isRenewal = true
				// Emit a renewed event on the OLD cert.
				meta, _ := json.Marshal(map[string]string{"newCertificateId": certID})
				if evErr := queries.InsertCertificateEvent(ctx, pool,
					existing.ID, orgID,
					"renewed", existing.Status, "",
					fmt.Sprintf("Certificate renewed: replaced by new fingerprint on %s:%d", report.Host, report.Port),
					meta,
				); evErr != nil {
					slog.Warn("cert: insert renewed event (old cert)", "err", evErr)
				}
			}
		}

		// Emit a discovered or renewed event on the NEW cert.
		eventType := "discovered"
		message := fmt.Sprintf("Certificate discovered on %s:%d (CN: %s)", report.Host, report.Port, report.CommonName)
		if isRenewal {
			eventType = "renewed"
			message = fmt.Sprintf("Certificate renewed on %s:%d (CN: %s)", report.Host, report.Port, report.CommonName)
		}
		if evErr := queries.InsertCertificateEvent(ctx, pool,
			certID, orgID,
			eventType, "", status,
			message, nil,
		); evErr != nil {
			slog.Warn("cert: insert discovered event", "err", evErr)
		}

		// Emit expiring/expired event immediately if the newly discovered cert is already in bad shape.
		if status == "expiring_soon" || status == "expired" {
			if evErr := queries.InsertCertificateEvent(ctx, pool,
				certID, orgID,
				status, "", status,
				fmt.Sprintf("Certificate %s: expires %s", status, report.NotAfter.Format("2006-01-02")),
				nil,
			); evErr != nil {
				slog.Warn("cert: insert expiry event on discover", "err", evErr)
			}
		}
		slog.Info("cert: new certificate persisted", "cert_id", certID, "cn", report.CommonName, "host", report.Host)
	} else {
		// Existing cert — check for status transition.
		if previousStatus != status && previousStatus != "" {
			if evErr := queries.InsertCertificateEvent(ctx, pool,
				certID, orgID,
				status, previousStatus, status,
				fmt.Sprintf("Certificate status changed from %s to %s", previousStatus, status),
				nil,
			); evErr != nil {
				slog.Warn("cert: insert status-change event", "err", evErr)
			}
		}
		slog.Debug("cert: certificate updated", "cert_id", certID, "cn", report.CommonName, "status", status)
	}

	// Immediately evaluate cert_expiry alert rules for this freshly-observed cert.
	evaluateCertExpiryForCert(ctx, pool, orgID, certID, report.CommonName, report.Issuer, report.Host, report.Port, report.NotAfter, status)
}
