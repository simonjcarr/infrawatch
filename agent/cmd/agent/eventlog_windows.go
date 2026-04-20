//go:build windows

package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"golang.org/x/sys/windows/svc/eventlog"

	"github.com/infrawatch/agent/internal/install"
)

// Event IDs written alongside each record. Windows surfaces them in Event
// Viewer's "Event ID" column — fixed values are fine because we're not
// distinguishing event classes, only severities.
const (
	eventIDInfo    uint32 = 1
	eventIDWarning uint32 = 2
	eventIDError   uint32 = 3
)

// eventLogHandler is a slog.Handler that forwards records to the Windows
// Application event log under the InfrawatchAgent source. Messages are
// rendered inline (message + key=value attrs) because AsEventCreate-style
// sources have no message table to look up strings at render time.
type eventLogHandler struct {
	elog  *eventlog.Log
	level slog.Level
	attrs []slog.Attr
	group string
}

func (h *eventLogHandler) Enabled(_ context.Context, l slog.Level) bool {
	return l >= h.level
}

func (h *eventLogHandler) Handle(_ context.Context, r slog.Record) error {
	var b strings.Builder
	b.WriteString(r.Message)
	for _, a := range h.attrs {
		appendAttr(&b, h.group, a)
	}
	r.Attrs(func(a slog.Attr) bool {
		appendAttr(&b, h.group, a)
		return true
	})
	msg := b.String()

	switch {
	case r.Level >= slog.LevelError:
		return h.elog.Error(eventIDError, msg)
	case r.Level >= slog.LevelWarn:
		return h.elog.Warning(eventIDWarning, msg)
	default:
		return h.elog.Info(eventIDInfo, msg)
	}
}

func (h *eventLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	merged := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	merged = append(merged, h.attrs...)
	merged = append(merged, attrs...)
	return &eventLogHandler{elog: h.elog, level: h.level, attrs: merged, group: h.group}
}

func (h *eventLogHandler) WithGroup(name string) slog.Handler {
	g := name
	if h.group != "" {
		g = h.group + "." + name
	}
	return &eventLogHandler{elog: h.elog, level: h.level, attrs: h.attrs, group: g}
}

func appendAttr(b *strings.Builder, group string, a slog.Attr) {
	if a.Equal(slog.Attr{}) {
		return
	}
	key := a.Key
	if group != "" {
		key = group + "." + key
	}
	fmt.Fprintf(b, " %s=%v", key, a.Value.Any())
}

// openEventLogHandler opens the Application event log source and returns a
// slog.Handler that writes to it. Returns nil if the source cannot be opened
// (e.g. the install step that registered it was skipped), so the caller can
// fall back to stdout.
func openEventLogHandler(level slog.Level) slog.Handler {
	elog, err := eventlog.Open(install.EventLogSource)
	if err != nil {
		return nil
	}
	return &eventLogHandler{elog: elog, level: level}
}
