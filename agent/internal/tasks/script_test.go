package tasks

import (
	"strings"
	"testing"
	"time"
)

func TestEffectiveScriptTimeoutDefaultsAndCaps(t *testing.T) {
	if got := effectiveScriptTimeout(0); got != defaultScriptTimeout {
		t.Fatalf("effectiveScriptTimeout(0) = %s, want %s", got, defaultScriptTimeout)
	}
	if got := effectiveScriptTimeout(int((2 * time.Hour) / time.Second)); got != maxScriptTimeout {
		t.Fatalf("effectiveScriptTimeout(2h) = %s, want %s", got, maxScriptTimeout)
	}
	if got := effectiveScriptTimeout(90); got != 90*time.Second {
		t.Fatalf("effectiveScriptTimeout(90) = %s, want %s", got, 90*time.Second)
	}
}

func TestRunCustomScriptRejectsUnsupportedInterpreter(t *testing.T) {
	result := RunCustomScript(t.Context(), `{"script":"echo hi","interpreter":"perl"}`, func(string) {})
	if result.Error == "" {
		t.Fatal("expected unsupported interpreter error")
	}
	if !strings.Contains(result.Error, "not permitted") {
		t.Fatalf("unexpected error: %q", result.Error)
	}
}
