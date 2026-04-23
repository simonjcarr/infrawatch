package loadtest

import (
	"fmt"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"

	agentgrpc "github.com/carrtech-dev/ct-ops/agent/internal/grpc"
)

// ConnPool is a lazy, thread-safe pool of shared gRPC connections.
// Virtual agents share connections so that 1000 agents don't open 1000 TLS
// connections — gRPC's HTTP/2 transport multiplexes concurrent streams over a
// single connection, and sharing reduces handshake cost, server-side per-conn
// bookkeeping, and file-descriptor use on the load-test VM.
type ConnPool struct {
	address       string
	caCertFile    string
	tlsSkipVerify bool

	mu    sync.Mutex
	conns []*grpc.ClientConn
	size  int
}

// NewConnPool creates a pool that will host up to size connections. Dialing
// happens lazily on first use of each slot.
func NewConnPool(address, caCertFile string, tlsSkipVerify bool, size int) *ConnPool {
	if size < 1 {
		size = 1
	}
	return &ConnPool{
		address:       address,
		caCertFile:    caCertFile,
		tlsSkipVerify: tlsSkipVerify,
		conns:         make([]*grpc.ClientConn, size),
		size:          size,
	}
}

// Get returns the connection for the given agent index, dialling or re-dialling
// if the slot is unset or in a non-recoverable state. Safe for concurrent use.
// Negative indexes (used by the preflight sentinel) are mapped to slot 0.
func (p *ConnPool) Get(agentIndex int) (*grpc.ClientConn, error) {
	slot := agentIndex % p.size
	if slot < 0 {
		slot += p.size
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	conn := p.conns[slot]
	if conn != nil {
		state := conn.GetState()
		if state != connectivity.Shutdown {
			return conn, nil
		}
		// Shutdown — dial a replacement below.
		conn = nil
	}

	// Load-test doesn't exercise mTLS — the driver-host can't present one
	// client cert per simulated agent. Keeping this non-mTLS is fine because
	// the load test spins up against a dedicated ingest instance.
	fresh, err := agentgrpc.Connect(p.address, p.caCertFile, p.tlsSkipVerify, nil)
	if err != nil {
		return nil, fmt.Errorf("dialling %s: %w", p.address, err)
	}
	p.conns[slot] = fresh
	return fresh, nil
}

// Close closes every dialled connection in the pool.
func (p *ConnPool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, c := range p.conns {
		if c != nil {
			_ = c.Close()
			p.conns[i] = nil
		}
	}
}

// Size returns the number of connection slots managed by the pool.
func (p *ConnPool) Size() int {
	return p.size
}
