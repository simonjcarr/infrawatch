//go:build !windows

package terminal

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/user"
	"regexp"
	"strconv"
	"syscall"

	"github.com/creack/pty"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// POSIX-compliant: starts with letter or underscore, contains only [a-zA-Z0-9_-], max 32 chars
var validUsernameRE = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$`)

// OpenSession opens a Terminal gRPC stream to the ingest service, creates a
// PTY running the user's shell, and bridges bytes between the PTY and the
// gRPC stream in real-time.
//
// dialFunc creates a fresh gRPC connection. jwtToken is passed as gRPC
// metadata for authentication. req contains the session ID and initial
// terminal dimensions.
//
// This function blocks until the PTY exits or the stream is closed.
func OpenSession(dialFunc func() (*grpc.ClientConn, error), jwtToken string, req *agentv1.TerminalSessionRequest) error {
	sessionID := req.SessionId
	slog.Info("opening terminal session", "session_id", sessionID, "cols", req.Cols, "rows", req.Rows)

	// Dial ingest
	conn, err := dialFunc()
	if err != nil {
		return fmt.Errorf("terminal dial: %w", err)
	}
	defer conn.Close()

	// Attach JWT as gRPC metadata. Use background context — terminal sessions
	// are independent of heartbeat and should not be cancelled when the
	// heartbeat stream reconnects.
	md := metadata.Pairs("authorization", "Bearer "+jwtToken)
	ctx := metadata.NewOutgoingContext(context.Background(), md)

	client := agentv1.NewIngestServiceClient(conn)
	stream, err := client.Terminal(ctx)
	if err != nil {
		return fmt.Errorf("terminal stream open: %w", err)
	}

	// Send handshake message with session ID
	if err := stream.Send(&agentv1.TerminalAgentMessage{SessionId: sessionID}); err != nil {
		return fmt.Errorf("terminal handshake send: %w", err)
	}

	// Build command based on auth mode
	var cmd *exec.Cmd
	if req.DirectAccess {
		// Legacy mode: run shell as agent user (prefer bash, fall back to sh)
		shell := os.Getenv("SHELL")
		if shell == "" {
			if _, err := os.Stat("/bin/bash"); err == nil {
				shell = "/bin/bash"
			} else {
				shell = "/bin/sh"
			}
		}
		cmd = exec.Command(shell, "-l")
		cmd.Dir = homeDir()
		env := os.Environ()
		env = setEnv(env, "TERM", "xterm-256color")
		env = setEnv(env, "HOME", homeDir())
		env = setEnv(env, "SHELL", shell)
		cmd.Env = env
		slog.Info("terminal: direct access mode", "session_id", sessionID, "shell", shell)
	} else if req.Username != "" {
		// Per-user mode: validate username and force authentication via su.
		//
		// su from root skips password authentication, so we drop privileges to
		// the "nobody" user first using SysProcAttr.Credential. Running su as
		// nobody forces PAM authentication — the user sees a "Password:" prompt.
		//
		// This approach works on both Debian/Ubuntu and RHEL/AlmaLinux, unlike
		// the login command which has cross-distro PAM/SELinux differences.
		if !validUsernameRE.MatchString(req.Username) {
			sendClosedMsg(stream, sessionID, -1)
			return fmt.Errorf("terminal: invalid username %q", req.Username)
		}
		// Verify the user actually exists on this system before spawning su.
		if _, err := user.Lookup(req.Username); err != nil {
			sendClosedMsg(stream, sessionID, -1)
			return fmt.Errorf("terminal: unknown user %q: %w", req.Username, err)
		}
		nobodyUID, nobodyGID, err := lookupNobody()
		if err != nil {
			sendClosedMsg(stream, sessionID, -1)
			return fmt.Errorf("terminal: cannot look up nobody user: %w", err)
		}
		cmd = exec.Command("su", "-", req.Username)
		cmd.Dir = "/"
		cmd.SysProcAttr = &syscall.SysProcAttr{
			Credential: &syscall.Credential{
				Uid: nobodyUID,
				Gid: nobodyGID,
			},
		}
		env := os.Environ()
		env = setEnv(env, "TERM", "xterm-256color")
		cmd.Env = env
		slog.Info("terminal: per-user mode", "session_id", sessionID, "username", req.Username)
	} else {
		// No username and not direct access — refuse session
		sendClosedMsg(stream, sessionID, -1)
		return fmt.Errorf("terminal: username required when direct access is disabled")
	}
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: uint16(req.Cols),
		Rows: uint16(req.Rows),
	})
	if err != nil {
		stream.Send(&agentv1.TerminalAgentMessage{
			SessionId: sessionID,
			Payload:   &agentv1.TerminalAgentMessage_Closed{Closed: &agentv1.TerminalClosedMsg{ExitCode: -1}},
		})
		return fmt.Errorf("terminal pty start: %w", err)
	}
	defer ptmx.Close()

	slog.Info("terminal PTY started", "session_id", sessionID, "cmd", cmd.Path)

	// Goroutine: read PTY output → send to ingest via gRPC stream
	ptyDone := make(chan struct{})
	go func() {
		defer close(ptyDone)
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				if sendErr := stream.Send(&agentv1.TerminalAgentMessage{
					SessionId: sessionID,
					Payload:   &agentv1.TerminalAgentMessage_Output{Output: data},
				}); sendErr != nil {
					slog.Debug("terminal: send output failed", "session_id", sessionID, "err", sendErr)
					return
				}
			}
			if err != nil {
				return // PTY closed (shell exited)
			}
		}
	}()

	// Goroutine: read from gRPC stream → write to PTY stdin / handle resize / close
	streamDone := make(chan struct{})
	go func() {
		defer close(streamDone)
		for {
			msg, err := stream.Recv()
			if err != nil {
				return
			}

			switch p := msg.Payload.(type) {
			case *agentv1.TerminalServerMessage_Input:
				if _, err := ptmx.Write(p.Input); err != nil {
					slog.Debug("terminal: write to PTY failed", "session_id", sessionID, "err", err)
					return
				}
			case *agentv1.TerminalServerMessage_Resize:
				if err := pty.Setsize(ptmx, &pty.Winsize{
					Cols: uint16(p.Resize.Cols),
					Rows: uint16(p.Resize.Rows),
				}); err != nil {
					slog.Debug("terminal: resize failed", "session_id", sessionID, "err", err)
				}
			case *agentv1.TerminalServerMessage_Close:
				// Browser disconnected — kill the shell
				cmd.Process.Signal(os.Interrupt)
				return
			}
		}
	}()

	// Wait for PTY to exit
	<-ptyDone

	// Get exit code
	var exitCode int32
	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = int32(exitErr.ExitCode())
		} else {
			exitCode = -1
		}
	}

	// Send closed message to ingest
	stream.Send(&agentv1.TerminalAgentMessage{
		SessionId: sessionID,
		Payload:   &agentv1.TerminalAgentMessage_Closed{Closed: &agentv1.TerminalClosedMsg{ExitCode: exitCode}},
	})
	stream.CloseSend()

	slog.Info("terminal session ended", "session_id", sessionID, "exit_code", exitCode)
	return nil
}

// lookupNobody returns the UID and GID of the "nobody" user.
// Falls back to 65534:65534 if the user cannot be found.
func lookupNobody() (uint32, uint32, error) {
	u, err := user.Lookup("nobody")
	if err != nil {
		// Fall back to the conventional nobody UID/GID
		return 65534, 65534, nil
	}
	uid, err := strconv.ParseUint(u.Uid, 10, 32)
	if err != nil {
		return 0, 0, fmt.Errorf("parse nobody uid: %w", err)
	}
	gid, err := strconv.ParseUint(u.Gid, 10, 32)
	if err != nil {
		return 0, 0, fmt.Errorf("parse nobody gid: %w", err)
	}
	return uint32(uid), uint32(gid), nil
}

// homeDir returns the current user's home directory, falling back to /root.
func homeDir() string {
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	return "/root"
}

// sendClosedMsg sends a TerminalClosedMsg to the ingest service.
func sendClosedMsg(stream agentv1.IngestService_TerminalClient, sessionID string, exitCode int32) {
	stream.Send(&agentv1.TerminalAgentMessage{
		SessionId: sessionID,
		Payload:   &agentv1.TerminalAgentMessage_Closed{Closed: &agentv1.TerminalClosedMsg{ExitCode: exitCode}},
	})
}

// setEnv sets or replaces an environment variable in a slice.
func setEnv(env []string, key, value string) []string {
	prefix := key + "="
	for i, e := range env {
		if len(e) >= len(prefix) && e[:len(prefix)] == prefix {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}
