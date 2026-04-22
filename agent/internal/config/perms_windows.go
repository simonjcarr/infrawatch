//go:build windows

package config

import "os"

// checkFilePermissions is a no-op on Windows; ACLs control access there.
func checkFilePermissions(_ string, _ os.FileInfo) error {
	return nil
}
