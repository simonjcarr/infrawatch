//go:build windows

package config

import "os"

func validateConfigOwner(_ string, _ os.FileInfo) error {
	return nil
}
