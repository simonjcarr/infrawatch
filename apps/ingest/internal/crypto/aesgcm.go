// Package ctcrypto mirrors apps/web/lib/crypto/encrypt.ts so that values
// written by either the web app or the ingest service can be read by the
// other. Format v1 blob: base64( VERSION(1) || salt(16) || iv(16) ||
// tag(16) || ciphertext ). Key = scrypt(secret, salt, N=16384, r=8, p=1, 32B).
//
// Keep this file in lock-step with apps/web/lib/crypto/encrypt.ts.
package ctcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"

	"golang.org/x/crypto/scrypt"
)

const (
	versionV1  = 0x01
	saltLength = 16
	ivLength   = 16
	tagLength  = 16
	keyLength  = 32

	scryptN = 16384
	scryptR = 8
	scryptP = 1
)

// Encrypt returns a base64-encoded v1 blob of plaintext.
func Encrypt(plaintext []byte) (string, error) {
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("rand salt: %w", err)
	}
	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return "", fmt.Errorf("rand iv: %w", err)
	}
	key, err := deriveKey(salt)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, ivLength)
	if err != nil {
		return "", fmt.Errorf("new gcm: %w", err)
	}

	ct := gcm.Seal(nil, iv, plaintext, nil)
	// Seal produces ciphertext || tag; match the Node layout (ciphertext separated from tag).
	if len(ct) < tagLength {
		return "", errors.New("gcm output too short")
	}
	ciphertext := ct[:len(ct)-tagLength]
	tag := ct[len(ct)-tagLength:]

	blob := make([]byte, 0, 1+saltLength+ivLength+tagLength+len(ciphertext))
	blob = append(blob, versionV1)
	blob = append(blob, salt...)
	blob = append(blob, iv...)
	blob = append(blob, tag...)
	blob = append(blob, ciphertext...)
	return base64.StdEncoding.EncodeToString(blob), nil
}

// Decrypt parses a v1 blob produced by Encrypt (or by the Node encrypt()).
// Legacy colon-separated format is NOT supported on this side — values
// written by the Go service are always v1.
func Decrypt(encoded string) ([]byte, error) {
	blob, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("base64 decode: %w", err)
	}
	if len(blob) < 1+saltLength+ivLength+tagLength {
		return nil, errors.New("ciphertext too short")
	}
	if blob[0] != versionV1 {
		return nil, fmt.Errorf("unknown encryption version 0x%02x", blob[0])
	}
	off := 1
	salt := blob[off : off+saltLength]
	off += saltLength
	iv := blob[off : off+ivLength]
	off += ivLength
	tag := blob[off : off+tagLength]
	off += tagLength
	ciphertext := blob[off:]

	key, err := deriveKey(salt)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, ivLength)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", err)
	}
	// gcm.Open expects ciphertext || tag concatenated.
	sealed := make([]byte, 0, len(ciphertext)+tagLength)
	sealed = append(sealed, ciphertext...)
	sealed = append(sealed, tag...)
	pt, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return nil, fmt.Errorf("gcm open: %w", err)
	}
	return pt, nil
}

func deriveKey(salt []byte) ([]byte, error) {
	secret := os.Getenv("LDAP_ENCRYPTION_KEY")
	if secret == "" {
		secret = os.Getenv("BETTER_AUTH_SECRET")
	}
	if secret == "" {
		return nil, errors.New("LDAP_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) must be set")
	}
	return scrypt.Key([]byte(secret), salt, scryptN, scryptR, scryptP, keyLength)
}
