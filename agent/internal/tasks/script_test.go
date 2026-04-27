package tasks

import (
	"strings"
	"testing"
	"time"
)

func TestEffectiveScriptTimeoutDefaultsAndCaps(t *testing.T) {
	if got, ok := effectiveScriptTimeout(0); ok || got != 0 {
		t.Fatalf("effectiveScriptTimeout(0) = (%s, %t), want (0s, false)", got, ok)
	}
	if got, ok := effectiveScriptTimeout(int((2 * time.Hour) / time.Second)); !ok || got != maxScriptTimeout {
		t.Fatalf("effectiveScriptTimeout(2h) = (%s, %t), want (%s, true)", got, ok, maxScriptTimeout)
	}
	if got, ok := effectiveScriptTimeout(90); !ok || got != 90*time.Second {
		t.Fatalf("effectiveScriptTimeout(90) = (%s, %t), want (%s, true)", got, ok, 90*time.Second)
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

func TestRunCustomScriptWithoutTimeoutKeepsInheritedDeadline(t *testing.T) {
	result := RunCustomScript(t.Context(), `{"script":"echo hi","interpreter":"sh"}`, func(string) {})
	if result.Error != "" {
		t.Fatalf("unexpected error: %q", result.Error)
	}
	if result.ExitCode != 0 {
		t.Fatalf("unexpected exit code: %d", result.ExitCode)
	}
}
