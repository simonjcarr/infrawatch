package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTIssuer handles JWT creation and the JWKS endpoint for agent authentication.
type JWTIssuer struct {
	privateKey *rsa.PrivateKey
	issuer     string
	tokenTTL   time.Duration
}

// NewJWTIssuer loads or generates an RSA key pair and creates a JWTIssuer.
func NewJWTIssuer(keyFile, issuer string, ttl time.Duration) (*JWTIssuer, error) {
	key, err := loadOrGenerateKey(keyFile)
	if err != nil {
		return nil, fmt.Errorf("loading JWT key: %w", err)
	}
	return &JWTIssuer{
		privateKey: key,
		issuer:     issuer,
		tokenTTL:   ttl,
	}, nil
}

// IssueAgentToken creates a signed JWT for an active agent.
func (j *JWTIssuer) IssueAgentToken(agentID, orgID string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub": agentID,
		"org": orgID,
		"iss": j.issuer,
		"iat": now.Unix(),
		"exp": now.Add(j.tokenTTL).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(j.privateKey)
}

// ValidateAgentToken parses and validates an agent JWT.
// Returns the agentID claim on success.
func (j *JWTIssuer) ValidateAgentToken(tokenStr string) (agentID, orgID string, err error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return &j.privateKey.PublicKey, nil
	}, jwt.WithIssuedAt(), jwt.WithIssuer(j.issuer))

	if err != nil {
		return "", "", fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", "", fmt.Errorf("invalid token claims")
	}

	agentID, _ = claims["sub"].(string)
	orgID, _ = claims["org"].(string)
	if agentID == "" {
		return "", "", fmt.Errorf("token missing sub claim")
	}
	return agentID, orgID, nil
}

// ValidateAgentTokenAllowExpired parses an agent JWT, verifying the signature
// and issuer but tolerating an expired token. This is used for the Terminal
// gRPC handler where the agent may hold a JWT that outlived its TTL — the
// agent identity is still trustworthy because the signature is valid.
func (j *JWTIssuer) ValidateAgentTokenAllowExpired(tokenStr string) (agentID, orgID string, err error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return &j.privateKey.PublicKey, nil
	}, jwt.WithIssuedAt(), jwt.WithIssuer(j.issuer), jwt.WithExpirationRequired(),
		// Accept tokens even if expired — we still verify the signature.
		jwt.WithLeeway(100*365*24*time.Hour))

	if err != nil {
		return "", "", fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", "", fmt.Errorf("invalid token claims")
	}

	agentID, _ = claims["sub"].(string)
	orgID, _ = claims["org"].(string)
	if agentID == "" {
		return "", "", fmt.Errorf("token missing sub claim")
	}
	return agentID, orgID, nil
}

// JWKSHandler returns an HTTP handler that serves the public key as JWKS.
func (j *JWTIssuer) JWKSHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		pubKey := &j.privateKey.PublicKey
		// Minimal JWKS response with the public key modulus and exponent
		type jwk struct {
			Kty string `json:"kty"`
			Use string `json:"use"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		}
		type jwks struct {
			Keys []jwk `json:"keys"`
		}

		n := pubKey.N.Bytes()
		e := make([]byte, 4)
		e[0] = byte(pubKey.E >> 24)
		e[1] = byte(pubKey.E >> 16)
		e[2] = byte(pubKey.E >> 8)
		e[3] = byte(pubKey.E)

		// Trim leading zeros from exponent
		i := 0
		for i < len(e)-1 && e[i] == 0 {
			i++
		}
		e = e[i:]

		keys := jwks{
			Keys: []jwk{{
				Kty: "RSA",
				Use: "sig",
				Alg: "RS256",
				N:   encodeBase64URL(n),
				E:   encodeBase64URL(e),
			}},
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(keys)
	}
}

func loadOrGenerateKey(keyFile string) (*rsa.PrivateKey, error) {
	if err := os.MkdirAll(filepath.Dir(keyFile), 0o700); err != nil {
		return nil, fmt.Errorf("creating key dir: %w", err)
	}

	if _, err := os.Stat(keyFile); err == nil {
		return loadKey(keyFile)
	}

	return generateKey(keyFile)
}

func generateKey(keyFile string) (*rsa.PrivateKey, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("generating RSA key: %w", err)
	}

	keyBytes := x509.MarshalPKCS1PrivateKey(key)
	pemBlock := &pem.Block{Type: "RSA PRIVATE KEY", Bytes: keyBytes}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(pemBlock), 0o600); err != nil {
		return nil, fmt.Errorf("writing key file: %w", err)
	}
	return key, nil
}

func loadKey(keyFile string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(keyFile)
	if err != nil {
		return nil, fmt.Errorf("reading key file: %w", err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("decoding PEM from %s", keyFile)
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing private key: %w", err)
	}
	return key, nil
}

func encodeBase64URL(b []byte) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	result := make([]byte, 0, (len(b)*4+2)/3)
	for i := 0; i < len(b); i += 3 {
		var chunk [3]byte
		n := copy(chunk[:], b[i:])
		switch n {
		case 3:
			result = append(result, chars[chunk[0]>>2], chars[(chunk[0]&3)<<4|chunk[1]>>4], chars[(chunk[1]&15)<<2|chunk[2]>>6], chars[chunk[2]&63])
		case 2:
			result = append(result, chars[chunk[0]>>2], chars[(chunk[0]&3)<<4|chunk[1]>>4], chars[(chunk[1]&15)<<2])
		case 1:
			result = append(result, chars[chunk[0]>>2], chars[(chunk[0]&3)<<4])
		}
	}
	return string(result)
}
