//go:build !windows

package config

import (
	"fmt"
	"os"
	"syscall"
)

func validateConfigOwner(path string, info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}

	euid := uint32(os.Geteuid())
	if stat.Uid == euid {
		return nil
	}

	expectedOwner := "root"
	if euid != 0 {
		expectedOwner = fmt.Sprintf("uid %d", euid)
	}

	return fmt.Errorf("config %s must be owned by %s (found uid %d)", path, expectedOwner, stat.Uid)
}
