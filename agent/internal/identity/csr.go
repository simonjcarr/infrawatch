package identity

import (
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
)

// BuildCSR returns DER-encoded PKCS#10 CSR bytes signed by the agent's Ed25519
// private key. The server fills in the SPIFFE URI SAN on the signed leaf so
// the CSR itself only carries a trivial Subject — the server is the source
// of truth for the agent's identity binding.
func (k *Keypair) BuildCSR() ([]byte, error) {
	tmpl := &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: "ct-ops-agent"},
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, tmpl, k.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("creating CSR: %w", err)
	}
	return der, nil
}
