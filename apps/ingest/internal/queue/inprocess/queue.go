// Package inprocess provides an in-process buffered channel queue implementation.
// Suitable for single-node deployments with <50 hosts. Replace with Redpanda
// consumer at standard/HA scale.
package inprocess

import (
	"fmt"
	"log/slog"

	"github.com/carrtech-dev/ct-ops/ingest/internal/queue"
)

const defaultBufferSize = 1000

// Queue is an in-process publisher using buffered channels.
type Queue struct {
	ch chan queue.Message
}

// New creates a new in-process queue with a buffered channel.
func New() *Queue {
	q := &Queue{ch: make(chan queue.Message, defaultBufferSize)}
	go q.drain()
	return q
}

// Publish enqueues a message. Returns an error if the buffer is full.
func (q *Queue) Publish(msg queue.Message) error {
	select {
	case q.ch <- msg:
		return nil
	default:
		return fmt.Errorf("queue buffer full (topic: %s)", msg.Topic)
	}
}

// Close drains and closes the queue.
func (q *Queue) Close() error {
	close(q.ch)
	return nil
}

// drain processes messages from the channel (no-op consumer for in-process mode).
// In production, each topic would have a dedicated consumer binary.
func (q *Queue) drain() {
	for msg := range q.ch {
		slog.Debug("queue message", "topic", msg.Topic, "size", len(msg.Payload))
	}
}
