// Package pki manages the internal agent CA used to mint per-agent client
// certificates for mTLS. The CA lives in the certificate_authorities table;
// its private key PEM is AES-256-GCM encrypted via the same scheme as the
// web app (apps/web/lib/crypto/encrypt.ts — ported in internal/crypto).
//
// Boot-time precedence:
//  1. BYO via env file paths (INGEST_AGENT_CA_CERT + INGEST_AGENT_CA_KEY)
//  2. Existing row in certificate_authorities where purpose='agent_ca' AND deleted_at IS NULL
//  3. Auto-generate a new CA, persist encrypted to DB
package pki

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	ctcrypto "github.com/carrtech-dev/ct-ops/ingest/internal/crypto"
)

const (
	caCommonName = "ct-ops Agent CA"
	caOrg        = "ct-ops"
	caValidity   = 10 * 365 * 24 * time.Hour // 10 years
)

// AgentCA holds the loaded CA material for signing leaf certs and building the
// trust pool ingest presents to incoming agent handshakes.
type AgentCA struct {
	Cert        *x509.Certificate
	CertPEM     []byte
	PrivateKey  *ecdsa.PrivateKey
	Fingerprint string // lowercase hex SHA-256 of DER
	Source      string // "auto" | "byo"
	ID          string // DB row id; empty for BYO-from-file
	// PreviousCerts are older agent CAs whose leaves have not yet all
	// expired. Added to the trust pool so rotation is non-disruptive.
	PreviousCerts []*x509.Certificate
}

// TrustPool returns an x509.CertPool containing the active CA plus any
// previous-generation CAs whose leaves are still valid.
func (a *AgentCA) TrustPool() *x509.CertPool {
	pool := x509.NewCertPool()
	pool.AddCert(a.Cert)
	for _, c := range a.PreviousCerts {
		pool.AddCert(c)
	}
	return pool
}

// LoadOrCreate resolves the agent CA per the documented precedence.
func LoadOrCreate(ctx context.Context, pool *pgxpool.Pool, byoCertFile, byoKeyFile string) (*AgentCA, error) {
	// 1. BYO from disk.
	if byoCertFile != "" && byoKeyFile != "" {
		ca, err := loadFromFiles(byoCertFile, byoKeyFile)
		if err != nil {
			return nil, fmt.Errorf("loading BYO agent CA: %w", err)
		}
		// Mirror metadata into the DB so the UI can show it.
		if err := upsertCARow(ctx, pool, ca, "byo"); err != nil {
			slog.Warn("upserting BYO agent CA metadata", "err", err)
		}
		prev, err := loadPreviousCAs(ctx, pool, ca.Fingerprint)
		if err != nil {
			slog.Warn("loading previous CA certs", "err", err)
		}
		ca.PreviousCerts = prev
		slog.Info("loaded BYO agent CA", "fingerprint", ca.Fingerprint, "not_after", ca.Cert.NotAfter)
		return ca, nil
	}

	// 2. DB.
	ca, err := loadFromDB(ctx, pool)
	if err == nil {
		prev, perr := loadPreviousCAs(ctx, pool, ca.Fingerprint)
		if perr != nil {
			slog.Warn("loading previous CA certs", "err", perr)
		}
		ca.PreviousCerts = prev
		slog.Info("loaded agent CA from DB", "fingerprint", ca.Fingerprint, "not_after", ca.Cert.NotAfter)
		return ca, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("loading agent CA from DB: %w", err)
	}

	// 3. Generate.
	ca, err = generateCA()
	if err != nil {
		return nil, fmt.Errorf("generating agent CA: %w", err)
	}
	if err := upsertCARow(ctx, pool, ca, "auto"); err != nil {
		return nil, fmt.Errorf("persisting generated agent CA: %w", err)
	}
	slog.Info("generated agent CA", "fingerprint", ca.Fingerprint, "not_after", ca.Cert.NotAfter)
	return ca, nil
}

// cuid2-style id; we reuse the DB's id generation via server-side default.
// For BYO-from-file we still insert a row and let the DB assign an id.

func loadFromFiles(certFile, keyFile string) (*AgentCA, error) {
	certPEM, err := os.ReadFile(certFile)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", certFile, err)
	}
	keyPEM, err := os.ReadFile(keyFile)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", keyFile, err)
	}
	cert, key, err := parseCertAndKey(certPEM, keyPEM)
	if err != nil {
		return nil, err
	}
	return &AgentCA{
		Cert:        cert,
		CertPEM:     certPEM,
		PrivateKey:  key,
		Fingerprint: fingerprint(cert),
		Source:      "byo",
	}, nil
}

func loadFromDB(ctx context.Context, pool *pgxpool.Pool) (*AgentCA, error) {
	var id, certPEM, keyEncrypted, source string
	err := pool.QueryRow(ctx, `
		SELECT id, cert_pem, key_pem_encrypted, source
		  FROM certificate_authorities
		 WHERE purpose = 'agent_ca' AND deleted_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT 1`).Scan(&id, &certPEM, &keyEncrypted, &source)
	if err != nil {
		return nil, err
	}
	keyPEMBytes, err := ctcrypto.Decrypt(keyEncrypted)
	if err != nil {
		return nil, fmt.Errorf("decrypting CA key: %w", err)
	}
	cert, key, err := parseCertAndKey([]byte(certPEM), keyPEMBytes)
	if err != nil {
		return nil, err
	}
	return &AgentCA{
		Cert:        cert,
		CertPEM:     []byte(certPEM),
		PrivateKey:  key,
		Fingerprint: fingerprint(cert),
		Source:      source,
		ID:          id,
	}, nil
}

// loadPreviousCAs returns any soft-deleted CAs whose not_after is still in the
// future. These stay in the trust pool to allow overlapping rotation.
func loadPreviousCAs(ctx context.Context, pool *pgxpool.Pool, activeFingerprint string) ([]*x509.Certificate, error) {
	rows, err := pool.Query(ctx, `
		SELECT cert_pem FROM certificate_authorities
		 WHERE purpose = 'agent_ca'
		   AND fingerprint_sha256 <> $1
		   AND not_after > NOW()`, activeFingerprint)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*x509.Certificate
	for rows.Next() {
		var certPEM string
		if err := rows.Scan(&certPEM); err != nil {
			return nil, err
		}
		cert, _, err := parseCertAndKey([]byte(certPEM), nil)
		if err != nil {
			continue
		}
		out = append(out, cert)
	}
	return out, rows.Err()
}

func upsertCARow(ctx context.Context, pool *pgxpool.Pool, ca *AgentCA, source string) error {
	keyPEM, err := marshalECKey(ca.PrivateKey)
	if err != nil {
		return err
	}
	encrypted, err := ctcrypto.Encrypt(keyPEM)
	if err != nil {
		return fmt.Errorf("encrypting CA key: %w", err)
	}
	// Upsert by fingerprint so BYO mounts on restart don't create duplicates.
	_, err = pool.Exec(ctx, `
		INSERT INTO certificate_authorities
			(id, purpose, cert_pem, key_pem_encrypted, source,
			 fingerprint_sha256, not_before, not_after, created_at, updated_at)
		VALUES
			(substr(md5(random()::text), 1, 24), 'agent_ca', $1, $2, $3, $4, $5, $6, NOW(), NOW())
		ON CONFLICT (fingerprint_sha256) DO UPDATE SET
			cert_pem = EXCLUDED.cert_pem,
			key_pem_encrypted = EXCLUDED.key_pem_encrypted,
			source = EXCLUDED.source,
			updated_at = NOW(),
			deleted_at = NULL`,
		string(ca.CertPEM), encrypted, source,
		ca.Fingerprint, ca.Cert.NotBefore, ca.Cert.NotAfter,
	)
	return err
}

func generateCA() (*AgentCA, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   caCommonName,
			Organization: []string{caOrg},
		},
		NotBefore:             now.Add(-1 * time.Minute),
		NotAfter:              now.Add(caValidity),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		return nil, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return &AgentCA{
		Cert:        cert,
		CertPEM:     certPEM,
		PrivateKey:  priv,
		Fingerprint: fingerprint(cert),
		Source:      "auto",
	}, nil
}

func parseCertAndKey(certPEM, keyPEM []byte) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	certBlock := findPEMBlock(certPEM, "CERTIFICATE")
	if certBlock == nil {
		return nil, nil, errors.New("cert PEM has no CERTIFICATE block")
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("parsing CA cert: %w", err)
	}
	if !cert.IsCA {
		return nil, nil, errors.New("provided cert is not a CA (BasicConstraintsValid/IsCA false)")
	}
	if keyPEM == nil {
		return cert, nil, nil
	}
	// OpenSSL's `ecparam -genkey` output prepends an EC PARAMETERS block
	// before the PRIVATE KEY block. Skip over params and anything else to
	// find the actual key material.
	keyBlock := findPEMBlock(keyPEM, "EC PRIVATE KEY", "PRIVATE KEY")
	if keyBlock == nil {
		return nil, nil, errors.New("key PEM has no (EC) PRIVATE KEY block")
	}
	key, err := parseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("parsing CA key: %w", err)
	}
	// Confirm the key matches the cert's public half.
	pub, ok := cert.PublicKey.(*ecdsa.PublicKey)
	if !ok || pub.X.Cmp(key.PublicKey.X) != 0 || pub.Y.Cmp(key.PublicKey.Y) != 0 {
		return nil, nil, errors.New("CA key does not match CA cert public key")
	}
	return cert, key, nil
}

// findPEMBlock returns the first PEM block in data whose Type matches any of
// allowed. nil if none found. Used to skip over EC PARAMETERS and similar
// multi-block OpenSSL outputs.
func findPEMBlock(data []byte, allowed ...string) *pem.Block {
	rest := data
	for {
		block, r := pem.Decode(rest)
		if block == nil {
			return nil
		}
		for _, t := range allowed {
			if block.Type == t {
				return block
			}
		}
		rest = r
	}
}

func parseECPrivateKey(der []byte) (*ecdsa.PrivateKey, error) {
	if k, err := x509.ParseECPrivateKey(der); err == nil {
		return k, nil
	}
	k, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, err
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("CA key is not ECDSA")
	}
	return ec, nil
}

func marshalECKey(key *ecdsa.PrivateKey) ([]byte, error) {
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}), nil
}

func fingerprint(cert *x509.Certificate) string {
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:])
}
