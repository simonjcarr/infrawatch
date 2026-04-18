package loadtest

import (
	"context"
	"fmt"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

const inventoryChunkSize = 500

// simulateInventoryStream opens a SubmitSoftwareInventory client-streaming RPC
// and uploads two chunks of fake packages followed by an is_last marker.
// Matches the real agent's chunked-upload contract so the ingest handler
// exercises the full persistence path.
func (v *VirtualAgent) simulateInventoryStream(ctx context.Context, client agentv1.IngestServiceClient, scanID string) {
	stream, err := client.SubmitSoftwareInventory(ctx)
	if err != nil {
		v.stats.RecordError(truncate("inventory stream open: "+err.Error(), 200))
		return
	}

	const totalChunks = 2
	for c := 0; c < totalChunks; c++ {
		pkgs := make([]*agentv1.SoftwarePackage, inventoryChunkSize)
		for i := 0; i < inventoryChunkSize; i++ {
			pkgs[i] = &agentv1.SoftwarePackage{
				Name:         fmt.Sprintf("loadtest-pkg-%d-%d", c, i),
				Version:      "1.0.0",
				Architecture: "amd64",
				Publisher:    "loadtest",
			}
		}
		chunk := &agentv1.SoftwareInventoryChunk{
			ScanId:     scanID,
			AgentId:    v.agentID,
			Source:     "loadtest",
			ChunkIndex: int32(c),
			IsLast:     c == totalChunks-1,
			Packages:   pkgs,
		}
		if err := stream.Send(chunk); err != nil {
			v.stats.RecordError(truncate("inventory send: "+err.Error(), 200))
			return
		}
	}

	if _, err := stream.CloseAndRecv(); err != nil {
		v.stats.RecordError(truncate("inventory close: "+err.Error(), 200))
		return
	}
	v.stats.InventoryScans.Add(1)
}
