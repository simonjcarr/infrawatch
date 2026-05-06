package heartbeat

import (
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
	"golang.org/x/crypto/ssh"
)

func collectSSHHostKeys() []*agentv1.SSHHostKey {
	keys, err := collectSSHHostKeysFromDir("/etc/ssh")
	if err != nil {
		slog.Debug("collecting SSH host keys", "err", err)
		return nil
	}
	return keys
}

func collectSSHHostKeysFromDir(dir string) ([]*agentv1.SSHHostKey, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "ssh_host_*.pub"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)

	keys := make([]*agentv1.SSHHostKey, 0, len(paths))
	seen := map[string]bool{}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Debug("reading SSH host public key", "path", path, "err", err)
			continue
		}
		pubKey, _, _, _, err := ssh.ParseAuthorizedKey(data)
		if err != nil {
			slog.Debug("parsing SSH host public key", "path", path, "err", err)
			continue
		}
		fp := ssh.FingerprintSHA256(pubKey)
		identity := pubKey.Type() + "\x00" + fp
		if seen[identity] {
			continue
		}
		seen[identity] = true
		keys = append(keys, &agentv1.SSHHostKey{
			Algorithm:         strings.TrimSpace(pubKey.Type()),
			FingerprintSha256: fp,
		})
	}
	return keys, nil
}
