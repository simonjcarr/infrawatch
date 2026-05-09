package updater

import (
	"crypto/tls"
	"net/http"
	"testing"
	"time"
)

func TestBuildHTTPClientUsesPinnedTrustAndTimeout(t *testing.T) {
	client, err := buildHTTPClient(nil)
	if err != nil {
		t.Fatalf("buildHTTPClient returned error: %v", err)
	}
	if client.Timeout != 10*time.Minute {
		t.Fatalf("expected 10 minute timeout, got %s", client.Timeout)
	}

	tr, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", client.Transport)
	}
	if tr.TLSClientConfig == nil {
		t.Fatal("expected TLS config")
	}
	if tr.TLSClientConfig.MinVersion != tls.VersionTLS12 {
		t.Fatalf("expected TLS 1.2 minimum, got %x", tr.TLSClientConfig.MinVersion)
	}
	if tr.TLSClientConfig.RootCAs == nil {
		t.Fatal("expected non-nil RootCAs")
	}
}
