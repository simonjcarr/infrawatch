package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
)

const (
	pubKeyFile  = "agent_key.pub"
	privKeyFile = "agent_key.pem"
)

// Keypair holds the agent's Ed25519 identity keys.
type Keypair struct {
	PublicKey  ed25519.PublicKey
	PrivateKey ed25519.PrivateKey
	// PublicKeyPEM is the PEM-encoded public key for transport.
	PublicKeyPEM string
}

// LoadOrGenerate loads an existing keypair from dataDir, or generates and
// persists a new one if it does not exist.
func LoadOrGenerate(dataDir string) (*Keypair, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("creating data dir: %w", err)
	}

	pubPath := filepath.Join(dataDir, pubKeyFile)
	privPath := filepath.Join(dataDir, privKeyFile)

	if _, err := os.Stat(privPath); os.IsNotExist(err) {
		return generate(dataDir, pubPath, privPath)
	}

	return load(pubPath, privPath)
}

func generate(dataDir, pubPath, privPath string) (*Keypair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generating keypair: %w", err)
	}

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pub,
	})
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: priv,
	})

	if err := os.WriteFile(pubPath, pubPEM, 0o600); err != nil {
		return nil, fmt.Errorf("writing public key: %w", err)
	}
	if err := os.WriteFile(privPath, privPEM, 0o600); err != nil {
		return nil, fmt.Errorf("writing private key: %w", err)
	}

	return &Keypair{
		PublicKey:    pub,
		PrivateKey:   priv,
		PublicKeyPEM: string(pubPEM),
	}, nil
}

func load(pubPath, privPath string) (*Keypair, error) {
	pubBytes, err := os.ReadFile(pubPath)
	if err != nil {
		return nil, fmt.Errorf("reading public key: %w", err)
	}
	privBytes, err := os.ReadFile(privPath)
	if err != nil {
		return nil, fmt.Errorf("reading private key: %w", err)
	}

	pubBlock, _ := pem.Decode(pubBytes)
	if pubBlock == nil {
		return nil, fmt.Errorf("decoding public key PEM")
	}
	privBlock, _ := pem.Decode(privBytes)
	if privBlock == nil {
		return nil, fmt.Errorf("decoding private key PEM")
	}

	pub := ed25519.PublicKey(pubBlock.Bytes)
	priv := ed25519.PrivateKey(privBlock.Bytes)

	return &Keypair{
		PublicKey:    pub,
		PrivateKey:   priv,
		PublicKeyPEM: string(pubBytes),
	}, nil
}
