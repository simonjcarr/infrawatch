//go:build !windows

package install

// Non-Windows platforms have no event log — installation/removal are no-ops so
// the shared install/uninstall flows can call these unconditionally.

const EventLogSource = ""

func installEventLogSource() error { return nil }
func removeEventLogSource() error  { return nil }
