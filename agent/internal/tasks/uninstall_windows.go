//go:build windows

package tasks

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// Windows process-creation flags not exposed by the stdlib constants.
const (
	detachedProcess     = 0x00000008
	createNewProcessGrp = 0x00000200
)

// launchDetachedUninstaller copies the agent binary to %TEMP% and spawns it
// there with -uninstall. Running from a temp path is required because the
// uninstall step removes C:\Program Files\ct-ops, which would fail on
// Windows if the currently-running executable was located inside it.
// The child is detached so it survives SCM stopping the service.
func launchDetachedUninstaller(binPath string) error {
	tmpBin, err := stageWindowsUninstaller(binPath)
	if err != nil {
		return fmt.Errorf("staging uninstaller binary: %w", err)
	}

	cmd := exec.Command(tmpBin, "-uninstall")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: detachedProcess | createNewProcessGrp,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("starting uninstaller: %w", err)
	}
	return nil
}

// stageWindowsUninstaller copies binPath into %TEMP% with a fixed name and
// returns the destination path. Overwrites any prior copy.
func stageWindowsUninstaller(binPath string) (string, error) {
	tmpDir := os.TempDir()
	dst := filepath.Join(tmpDir, "ct-ops-uninstaller.exe")

	srcFile, err := os.Open(binPath)
	if err != nil {
		return "", fmt.Errorf("opening source binary: %w", err)
	}
	defer srcFile.Close()

	dstFile, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return "", fmt.Errorf("creating destination: %w", err)
	}
	defer dstFile.Close()

	buf := make([]byte, 64*1024)
	for {
		n, rerr := srcFile.Read(buf)
		if n > 0 {
			if _, werr := dstFile.Write(buf[:n]); werr != nil {
				return "", fmt.Errorf("writing destination: %w", werr)
			}
		}
		if rerr != nil {
			break
		}
	}
	return dst, nil
}
