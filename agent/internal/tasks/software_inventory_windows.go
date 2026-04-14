//go:build windows

package tasks

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// collectPackages — Windows implementation: walks both 32- and 64-bit
// Uninstall registry hives and deduplicates by (DisplayName, DisplayVersion).
func collectPackages(_ context.Context) ([]collectedPackage, string, error) {
	pkgs, err := collectWindowsPackages()
	return pkgs, "winreg", err
}

const (
	uninstallKey32 = `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`
	uninstallKey64 = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
)

func collectWindowsPackages() ([]collectedPackage, error) {
	seen := make(map[string]struct{})
	var pkgs []collectedPackage

	for _, keyPath := range []string{uninstallKey64, uninstallKey32} {
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, keyPath, registry.READ)
		if err != nil {
			slog.Debug("software_inventory: opening registry key", "path", keyPath, "err", err)
			continue
		}

		subkeys, err := k.ReadSubKeyNames(-1)
		if err != nil {
			k.Close()
			continue
		}

		for _, sub := range subkeys {
			sk, err := registry.OpenKey(k, sub, registry.READ)
			if err != nil {
				continue
			}
			name, _, _ := sk.GetStringValue("DisplayName")
			version, _, _ := sk.GetStringValue("DisplayVersion")
			publisher, _, _ := sk.GetStringValue("Publisher")
			sk.Close()

			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			version = strings.TrimSpace(version)

			key := fmt.Sprintf("%s\x00%s", name, version)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}

			pkgs = append(pkgs, collectedPackage{
				Name:      name,
				Version:   version,
				Publisher: strings.TrimSpace(publisher),
			})
		}
		k.Close()
	}

	return pkgs, nil
}
