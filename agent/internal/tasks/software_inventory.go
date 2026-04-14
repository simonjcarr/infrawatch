package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// swInv* hold the agent's identity and dial function, set once from main before
// the heartbeat loop starts. Package-level vars are safe here because the agent
// is single-process and these are only written during startup.
var (
	swInvDialFunc func() (*grpc.ClientConn, error)
	swInvAgentID  string
	swInvJWT      string
)

// SetDialFunc injects the gRPC dial function used by the software_inventory
// handler to open its own streaming connection to the ingest service.
func SetDialFunc(fn func() (*grpc.ClientConn, error)) { swInvDialFunc = fn }

// SetAgentID stores the agent's stable ID for inclusion in inventory chunks.
func SetAgentID(id string) { swInvAgentID = id }

// SetJWTToken stores the agent's JWT token for authenticating the inventory stream.
func SetJWTToken(token string) { swInvJWT = token }

func init() {
	Register("software_inventory", RunSoftwareInventory)
}

// softwareInventoryResult is stored in task_run_hosts.result; the actual
// package list travels separately via SubmitSoftwareInventory.
type softwareInventoryResult struct {
	ScanID       string `json:"scan_id"`
	PackageCount int    `json:"package_count"`
	Source       string `json:"source"`
	StartedAt    string `json:"started_at"`
	CompletedAt  string `json:"completed_at"`
}

// collectedPackage holds a single installed package from any package manager.
type collectedPackage struct {
	Name        string
	Version     string
	Arch        string
	Publisher   string
	InstallDate int64 // Unix timestamp; 0 if unknown
}

const swInvChunkSize = 500

// RunSoftwareInventory collects installed packages and streams them to the
// ingest service via the SubmitSoftwareInventory gRPC endpoint.
// collectPackages is implemented per platform in software_inventory_unix.go /
// software_inventory_windows.go.
func RunSoftwareInventory(ctx context.Context, _ string, progressFn func(chunk string)) *agentv1.AgentTaskResult {
	startedAt := time.Now()
	scanID := TaskIDFromContext(ctx)

	if swInvDialFunc == nil {
		return &agentv1.AgentTaskResult{ExitCode: -1, Error: "software_inventory: dial function not initialised"}
	}

	progressFn("collecting installed packages…\n")

	packages, source, err := collectPackages(ctx)
	if err != nil {
		slog.Warn("software_inventory: collectPackages", "err", err)
		// Return a partial result rather than failing entirely when no
		// package manager is found — the task still completes with 0 packages.
	}

	progressFn(fmt.Sprintf("collected %d packages (source: %s), streaming to server…\n", len(packages), source))

	if err := streamPackages(ctx, scanID, source, packages, progressFn); err != nil {
		return &agentv1.AgentTaskResult{ExitCode: -1, Error: fmt.Sprintf("streaming packages: %v", err)}
	}

	completedAt := time.Now()
	result := softwareInventoryResult{
		ScanID:       scanID,
		PackageCount: len(packages),
		Source:       source,
		StartedAt:    startedAt.UTC().Format(time.RFC3339),
		CompletedAt:  completedAt.UTC().Format(time.RFC3339),
	}
	resultJSON, _ := json.Marshal(result)
	progressFn(fmt.Sprintf("done — %d packages submitted\n", len(packages)))

	return &agentv1.AgentTaskResult{
		ExitCode:   0,
		ResultJson: string(resultJSON),
	}
}

// streamPackages opens a SubmitSoftwareInventory stream and sends packages in
// chunks of swInvChunkSize.
func streamPackages(ctx context.Context, scanID, source string, pkgs []collectedPackage, progressFn func(string)) error {
	conn, err := swInvDialFunc()
	if err != nil {
		return fmt.Errorf("connecting to ingest: %w", err)
	}
	defer conn.Close()

	// Attach JWT as gRPC metadata for authentication on the server side.
	if swInvJWT != "" {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+swInvJWT)
	}

	client := agentv1.NewIngestServiceClient(conn)
	stream, err := client.SubmitSoftwareInventory(ctx)
	if err != nil {
		return fmt.Errorf("opening stream: %w", err)
	}

	chunkIndex := int32(0)
	for i := 0; i < len(pkgs); i += swInvChunkSize {
		end := i + swInvChunkSize
		if end > len(pkgs) {
			end = len(pkgs)
		}
		batch := pkgs[i:end]
		isLast := end == len(pkgs)

		protoPackages := make([]*agentv1.SoftwarePackage, len(batch))
		for j, p := range batch {
			protoPackages[j] = &agentv1.SoftwarePackage{
				Name:            p.Name,
				Version:         p.Version,
				Architecture:    p.Arch,
				Publisher:       p.Publisher,
				InstallDateUnix: p.InstallDate,
			}
		}

		chunk := &agentv1.SoftwareInventoryChunk{
			ScanId:     scanID,
			AgentId:    swInvAgentID,
			Source:     source,
			ChunkIndex: chunkIndex,
			IsLast:     isLast,
			Packages:   protoPackages,
		}
		if err := stream.Send(chunk); err != nil {
			return fmt.Errorf("sending chunk %d: %w", chunkIndex, err)
		}
		progressFn(fmt.Sprintf("chunk %d sent (%d packages)\n", chunkIndex, len(batch)))
		chunkIndex++
	}

	// If there were no packages, send a single empty final chunk so the server
	// knows the scan is complete.
	if len(pkgs) == 0 {
		if err := stream.Send(&agentv1.SoftwareInventoryChunk{
			ScanId:  scanID,
			AgentId: swInvAgentID,
			Source:  source,
			IsLast:  true,
		}); err != nil {
			return fmt.Errorf("sending empty final chunk: %w", err)
		}
	}

	if _, err := stream.CloseAndRecv(); err != nil {
		return fmt.Errorf("closing stream: %w", err)
	}
	return nil
}
