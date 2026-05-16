package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/ssh"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
)

// TerminalWSHandler serves browser WebSocket connections for SSH-backed
// terminal sessions. It never asks the agent to open a shell.
type TerminalWSHandler struct {
	pool       *pgxpool.Pool
	acceptOpts *websocket.AcceptOptions
}

func NewTerminalWSHandler(pool *pgxpool.Pool, trustedOrigins []string) (*TerminalWSHandler, error) {
	acceptOpts, err := terminalWSAcceptOptions(trustedOrigins)
	if err != nil {
		return nil, err
	}
	return &TerminalWSHandler{
		pool:       pool,
		acceptOpts: acceptOpts,
	}, nil
}

type wsMessage struct {
	Type     string `json:"type"`
	Data     string `json:"data,omitempty"`
	Cols     uint32 `json:"cols,omitempty"`
	Rows     uint32 `json:"rows,omitempty"`
	Msg      string `json:"message,omitempty"`
	Code     int32  `json:"exit_code,omitempty"`
	Token    string `json:"token,omitempty"`
	Password string `json:"password,omitempty"`
	Port     uint32 `json:"port,omitempty"`
}

func (h *TerminalWSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/ws/terminal/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "missing session ID", http.StatusBadRequest)
		return
	}
	sessionID := parts[0]

	conn, err := websocket.Accept(w, r, h.acceptOpts)
	if err != nil {
		slog.Warn("terminal ws: accept failed", "err", err)
		return
	}
	defer conn.CloseNow()

	ctx := r.Context()
	authCtx, cancelAuth := context.WithTimeout(ctx, 20*time.Second)
	_, rawAuth, err := conn.Read(authCtx)
	cancelAuth()
	if err != nil {
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: "SSH credentials were not received"})
		conn.Close(websocket.StatusPolicyViolation, "missing credentials")
		return
	}

	var authMsg wsMessage
	if err := json.Unmarshal(rawAuth, &authMsg); err != nil || authMsg.Type != "auth" || authMsg.Token == "" || authMsg.Password == "" {
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: "Invalid SSH authentication request"})
		conn.Close(websocket.StatusPolicyViolation, "invalid authentication")
		return
	}
	sshPort, err := terminalSSHPort(authMsg.Port)
	if err != nil {
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: "Invalid SSH port"})
		conn.Close(websocket.StatusPolicyViolation, "invalid port")
		return
	}

	tokenSum := sha256.Sum256([]byte(authMsg.Token))
	info, err := queries.ValidateAndActivateTerminalSession(ctx, h.pool, sessionID, hex.EncodeToString(tokenSum[:]))
	if err != nil {
		slog.Warn("terminal ws: invalid session", "session_id", sessionID, "err", err)
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: "Invalid or expired terminal session"})
		conn.Close(websocket.StatusPolicyViolation, "invalid session")
		return
	}
	if info.Host == "" || info.Username == "" {
		_ = queries.SetTerminalSessionError(context.Background(), h.pool, sessionID, "missing SSH target")
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: "Host SSH target is unavailable"})
		return
	}

	source := terminalRemoteAddr(r.RemoteAddr)
	throttleStatus, err := queries.CheckTerminalAuthThrottle(ctx, h.pool, *info, source)
	if err != nil {
		slog.Warn("terminal ws: auth throttle check failed", "session_id", sessionID, "host_id", info.HostID, "username", info.Username, "err", err)
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: "Unable to verify SSH authentication rate limits"})
		return
	}
	if !throttleStatus.Allowed {
		_ = queries.SetTerminalSessionError(context.Background(), h.pool, sessionID, "ssh authentication throttled")
		slog.Warn("terminal ws: SSH authentication throttled", "session_id", sessionID, "host_id", info.HostID, "username", info.Username, "retry_after", throttleStatus.RetryAfter.String())
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: "Too many SSH authentication attempts. Try again later."})
		return
	}

	slog.Info("terminal ws: opening SSH session", "session_id", sessionID, "host_id", info.HostID, "username", info.Username, "port", sshPort)
	sshClient, sshSession, stdin, stdout, err := h.openSSHSession(ctx, info.HostID, info.Host, info.Username, authMsg.Password, sshPort)
	authMsg.Password = ""
	if err != nil {
		slog.Warn("terminal ws: SSH connection failed", "session_id", sessionID, "host_id", info.HostID, "username", info.Username, "err", err)
		reason, message := terminalSSHFailureDetails(err)
		if errors.Is(err, queries.ErrSSHHostKeyNotTrusted) || errors.Is(err, queries.ErrSSHHostKeyMismatch) {
			reason = "ssh host key verification failed"
			message = "SSH host key verification failed"
		} else if isSSHAuthenticationFailure(err) {
			if status, recordErr := queries.RecordTerminalAuthFailure(context.Background(), h.pool, *info, source); recordErr != nil {
				slog.Warn("terminal ws: failed to record SSH authentication failure", "session_id", sessionID, "host_id", info.HostID, "username", info.Username, "err", recordErr)
			} else if !status.Allowed {
				slog.Warn("terminal ws: SSH authentication locked out", "session_id", sessionID, "host_id", info.HostID, "username", info.Username, "retry_after", status.RetryAfter.String())
			}
		}
		_ = queries.SetTerminalSessionError(context.Background(), h.pool, sessionID, reason)
		writeWS(ctx, conn, wsMessage{Type: "error", Msg: message})
		return
	}
	if err := queries.ResetTerminalAuthThrottle(context.Background(), h.pool, *info, source); err != nil {
		slog.Warn("terminal ws: failed to reset SSH auth throttle", "session_id", sessionID, "host_id", info.HostID, "username", info.Username, "err", err)
	}
	defer sshClient.Close()
	defer sshSession.Close()

	startedAt := time.Now()
	var recording strings.Builder
	var recordingMu sync.Mutex
	defer func() {
		duration := int(time.Since(startedAt).Seconds())
		recordingText := ""
		if info.LoggingEnabled {
			recordingMu.Lock()
			recordingText = recording.String()
			recordingMu.Unlock()
		}
		if err := queries.SetTerminalSessionEnded(context.Background(), h.pool, sessionID, duration, recordingText); err != nil {
			slog.Warn("terminal ws: failed to record session end", "session_id", sessionID, "err", err)
		}
		slog.Info("terminal ws: SSH session ended", "session_id", sessionID, "duration_seconds", duration)
	}()

	if err := writeWS(ctx, conn, wsMessage{Type: "ssh_connected"}); err != nil {
		return
	}

	outputDone := make(chan struct{})
	go func() {
		defer close(outputDone)
		buf := make([]byte, 4096)
		for {
			n, readErr := stdout.Read(buf)
			if n > 0 {
				chunk := append([]byte(nil), buf[:n]...)
				if info.LoggingEnabled {
					recordingMu.Lock()
					recording.Write(chunk)
					recordingMu.Unlock()
				}
				if err := writeWS(ctx, conn, wsMessage{
					Type: "output",
					Data: base64.StdEncoding.EncodeToString(chunk),
				}); err != nil {
					return
				}
			}
			if readErr != nil {
				if readErr != io.EOF {
					slog.Debug("terminal ws: SSH stdout read failed", "session_id", sessionID, "err", readErr)
				}
				return
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-outputDone:
			writeWS(ctx, conn, wsMessage{Type: "closed"})
			conn.Close(websocket.StatusNormalClosure, "session ended")
			return
		default:
		}

		_, rawMsg, err := conn.Read(ctx)
		if err != nil {
			return
		}

		var msg wsMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			decoded, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil {
				continue
			}
			if _, err := stdin.Write(decoded); err != nil {
				return
			}
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				_ = sshSession.WindowChange(int(msg.Rows), int(msg.Cols))
			}
		case "close":
			_ = sshSession.Signal(ssh.SIGTERM)
			return
		}
	}
}

func terminalWSAcceptOptions(trustedOrigins []string) (*websocket.AcceptOptions, error) {
	patterns := make([]string, 0, len(trustedOrigins))
	for _, raw := range trustedOrigins {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}

		parsed, err := url.Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("parse terminal trusted origin %q: %w", raw, err)
		}
		if parsed.Scheme == "" || parsed.Host == "" {
			return nil, fmt.Errorf("terminal trusted origin %q must include scheme and host", raw)
		}
		if parsed.Path != "" && parsed.Path != "/" {
			return nil, errors.New("terminal trusted origins must not include a path")
		}
		if parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, errors.New("terminal trusted origins must not include query or fragment")
		}

		patterns = append(patterns, parsed.Scheme+"://"+parsed.Host)
	}

	return &websocket.AcceptOptions{
		OriginPatterns: patterns,
	}, nil
}

func (h *TerminalWSHandler) openSSHSession(ctx context.Context, hostID, host, username, password, port string) (*ssh.Client, *ssh.Session, io.WriteCloser, io.Reader, error) {
	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
			ssh.KeyboardInteractive(func(_ string, _ string, questions []string, _ []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range answers {
					answers[i] = password
				}
				return answers, nil
			}),
		},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			return queries.VerifySSHHostKey(ctx, h.pool, hostID, ssh.FingerprintSHA256(key))
		},
		Timeout: 30 * time.Second,
	}

	address := net.JoinHostPort(host, port)
	type dialResult struct {
		client *ssh.Client
		err    error
	}
	resultCh := make(chan dialResult, 1)
	go func() {
		client, err := ssh.Dial("tcp", address, config)
		resultCh <- dialResult{client: client, err: err}
	}()

	var client *ssh.Client
	select {
	case <-ctx.Done():
		return nil, nil, nil, nil, ctx.Err()
	case result := <-resultCh:
		if result.err != nil {
			return nil, nil, nil, nil, result.err
		}
		client = result.client
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, nil, nil, nil, err
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, nil, err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, nil, err
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, nil, err
	}
	if err := session.Shell(); err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, nil, err
	}

	return client, session, stdin, stdout, nil
}

func terminalRemoteAddr(remoteAddr string) string {
	remoteAddr = strings.TrimSpace(remoteAddr)
	if remoteAddr == "" {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil && host != "" {
		return host
	}
	return remoteAddr
}

func terminalSSHPort(port uint32) (string, error) {
	if port == 0 {
		return "22", nil
	}
	if port > 65535 {
		return "", fmt.Errorf("SSH port %d is out of range", port)
	}
	return strconv.FormatUint(uint64(port), 10), nil
}

func isSSHAuthenticationFailure(err error) bool {
	var authErr *ssh.ServerAuthError
	return errors.As(err, &authErr)
}

func terminalSSHFailureDetails(err error) (reason string, message string) {
	if isSSHAuthenticationFailure(err) {
		return "ssh authentication failed", "SSH authentication failed"
	}
	return "ssh connection failed", "SSH connection failed"
}

func writeWS(ctx context.Context, conn *websocket.Conn, msg wsMessage) error {
	raw, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal websocket message: %w", err)
	}
	return conn.Write(ctx, websocket.MessageText, raw)
}
