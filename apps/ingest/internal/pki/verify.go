package pki

import (
	"crypto/x509"
	"errors"
	"fmt"
)

// VerifyLeaf is the peer-cert check run inside tls.Config.VerifyPeerCertificate.
// It assumes the standard chain verification has already run (via
// tls.RequireAndVerifyClientCert + ClientCAs). On top of that it enforces:
//
//   - The verified chain includes a SPIFFE URI SAN naming a ct-ops org+agent.
//   - The leaf serial is not in the revocation set.
//
// The returned orgID/agentID are the SPIFFE-encoded identity bound to the
// handshake. Callers (auth interceptors) must compare these against the
// JWT sub/org claim to catch a cert-JWT mismatch.
func VerifyLeaf(verifiedChains [][]*x509.Certificate, revoked *Revocation) (orgID, agentID string, err error) {
	if len(verifiedChains) == 0 || len(verifiedChains[0]) == 0 {
		return "", "", errors.New("no verified chain presented")
	}
	leaf := verifiedChains[0][0]
	orgID, agentID, err = SpiffeURIFromCert(leaf)
	if err != nil {
		return "", "", err
	}
	if revoked != nil && revoked.Has(leaf.SerialNumber.Text(16)) {
		return "", "", fmt.Errorf("client cert serial %s is revoked", leaf.SerialNumber.Text(16))
	}
	return orgID, agentID, nil
}
