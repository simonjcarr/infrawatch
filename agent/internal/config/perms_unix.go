//go:build !windows

package config

import (
	"fmt"
	"os"
)

// checkFilePermissions rejects config files that are readable by group or world.
// A later chmod by an unprivileged user could expose the enrolment token.
func checkFilePermissions(path string, fi os.FileInfo) error {
	if fi.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("config file %s has unsafe permissions %04o; expected 0600 or more restrictive", path, fi.Mode().Perm())
	}
	return nil
}
