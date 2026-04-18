package loadtest

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"

	"github.com/infrawatch/agent/internal/identity"
)

// GenerateInMemoryKeypair returns a fresh Ed25519 keypair without touching
// disk. The real agent persists keys to the data directory; the load tester
// creates hundreds of ephemeral keypairs per run, so disk I/O is skipped to
// keep ramp-up fast and leave no cleanup state on the tester VM.
func GenerateInMemoryKeypair() (*identity.Keypair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generating keypair: %w", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pub,
	})
	return &identity.Keypair{
		PublicKey:    pub,
		PrivateKey:   priv,
		PublicKeyPEM: string(pubPEM),
	}, nil
}
