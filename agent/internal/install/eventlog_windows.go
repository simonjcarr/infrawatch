//go:build windows

package install

import (
	"errors"
	"syscall"

	"golang.org/x/sys/windows/svc/eventlog"
)

// EventLogSource is the Windows Event Log source name the agent writes under.
// Registered on install, removed on uninstall, opened by the running service.
const EventLogSource = "InfrawatchAgent"

// installEventLogSource registers the agent as an event source under the
// Application log. AsEventCreate avoids needing a compiled message table —
// messages are supplied at write time. Safe to call when the source already
// exists (the ERROR_FILE_EXISTS case is treated as success).
func installEventLogSource() error {
	const types = eventlog.Info | eventlog.Warning | eventlog.Error
	err := eventlog.InstallAsEventCreate(EventLogSource, types)
	if err == nil || errors.Is(err, syscall.ERROR_FILE_EXISTS) {
		return nil
	}
	return err
}

// removeEventLogSource deletes the agent's Application-log source. Treats
// "source does not exist" as success so uninstall stays idempotent.
func removeEventLogSource() error {
	err := eventlog.Remove(EventLogSource)
	if err == nil || errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) {
		return nil
	}
	return err
}
