package handlers

import (
	"context"
	"strings"
	"sync"
	"time"
)

const maxRecordingBytes = 10 * 1024 * 1024 // 10 MB cap on session recording

// terminalSession holds the channel pair that bridges a browser WebSocket
// connection to an agent gRPC Terminal stream.
type terminalSession struct {
	// fromBrowser carries input bytes (keystrokes) and control frames from the
	// WebSocket handler to the gRPC Terminal handler which forwards them to the agent.
	fromBrowser chan []byte

	// toBrowser carries PTY output bytes from the gRPC Terminal handler
	// (received from the agent) to the WebSocket handler which sends them to the browser.
	toBrowser chan []byte

	// agentConnected is closed by the gRPC Terminal handler when the agent
	// successfully bridges this session. The WS handler watches this to
	// notify the browser that the full pipeline is up.
	agentConnected chan struct{}

	cancel    context.CancelFunc
	startedAt time.Time

	// recording accumulates PTY output when compliance logging is enabled.
	// nil means logging is disabled for this session.
	recording *strings.Builder

	loggingEnabled bool

	// pushCount tracks how many times this session has been included in a
	// heartbeat response sent to the agent. Used for diagnostics.
	pushCount int64

	mu sync.Mutex
}

// incrementPushCount atomically increments the push counter.
func (s *terminalSession) incrementPushCount() {
	s.mu.Lock()
	s.pushCount++
	s.mu.Unlock()
}

// getPushCount returns the current push counter value.
func (s *terminalSession) getPushCount() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pushCount
}

// appendRecording appends PTY output to the recording buffer if logging is enabled.
// Stops recording once the buffer exceeds maxRecordingBytes.
func (s *terminalSession) appendRecording(data []byte) {
	if !s.loggingEnabled || s.recording == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recording.Len()+len(data) > maxRecordingBytes {
		return // cap exceeded, stop recording
	}
	s.recording.Write(data)
}

// getRecording returns the accumulated recording, or empty string if logging disabled.
func (s *terminalSession) getRecording() string {
	if s.recording == nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.recording.String()
}

// TerminalStore manages active terminal sessions, providing the rendezvous
// point between the WebSocket handler (browser side) and the gRPC Terminal
// handler (agent side).
type TerminalStore struct {
	mu       sync.RWMutex
	sessions map[string]*terminalSession
}

// NewTerminalStore creates an empty terminal store.
func NewTerminalStore() *TerminalStore {
	return &TerminalStore{
		sessions: make(map[string]*terminalSession),
	}
}

// Register adds a new terminal session slot. Called by the WebSocket handler
// after validating the session in the database. Returns the session and a
// context that is cancelled when the session is removed.
func (s *TerminalStore) Register(sessionID string, loggingEnabled bool) (*terminalSession, context.Context) {
	ctx, cancel := context.WithCancel(context.Background())

	var rec *strings.Builder
	if loggingEnabled {
		rec = &strings.Builder{}
	}

	sess := &terminalSession{
		fromBrowser:    make(chan []byte, 64),
		toBrowser:      make(chan []byte, 64),
		agentConnected: make(chan struct{}),
		cancel:         cancel,
		startedAt:      time.Now(),
		recording:      rec,
		loggingEnabled: loggingEnabled,
	}

	s.mu.Lock()
	s.sessions[sessionID] = sess
	s.mu.Unlock()

	return sess, ctx
}

// Get retrieves a session by ID. Returns nil, false if not found.
func (s *TerminalStore) Get(sessionID string) (*terminalSession, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[sessionID]
	return sess, ok
}

// WaitFor polls for a session to appear in the store, returning it once found
// or nil if the timeout elapses. Used by the gRPC Terminal handler to wait for
// the WebSocket handler to register the session.
func (s *TerminalStore) WaitFor(sessionID string, timeout time.Duration) (*terminalSession, bool) {
	deadline := time.After(timeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-deadline:
			return nil, false
		case <-ticker.C:
			if sess, ok := s.Get(sessionID); ok {
				return sess, true
			}
		}
	}
}

// Remove deletes a session from the store and cancels its context.
func (s *TerminalStore) Remove(sessionID string) {
	s.mu.Lock()
	sess, ok := s.sessions[sessionID]
	if ok {
		delete(s.sessions, sessionID)
	}
	s.mu.Unlock()

	if ok && sess.cancel != nil {
		sess.cancel()
	}
}
