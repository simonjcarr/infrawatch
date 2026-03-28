package identity

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const stateFile = "agent_state.json"

// AgentState holds the persisted agent ID and JWT after successful registration.
type AgentState struct {
	AgentID  string `json:"agent_id"`
	JWTToken string `json:"jwt_token"`
}

// LoadState loads the persisted agent state from dataDir.
// Returns an empty state (not an error) if no state file exists yet.
func LoadState(dataDir string) (*AgentState, error) {
	path := filepath.Join(dataDir, stateFile)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &AgentState{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading agent state: %w", err)
	}

	var state AgentState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("parsing agent state: %w", err)
	}
	return &state, nil
}

// SaveState writes the agent state to dataDir.
func SaveState(dataDir string, state *AgentState) error {
	path := filepath.Join(dataDir, stateFile)
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshalling agent state: %w", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("writing agent state: %w", err)
	}
	return nil
}
