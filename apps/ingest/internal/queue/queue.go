package queue

// Topic constants for the queue.
const (
	TopicMetricsRaw    = "metrics.raw"
	TopicEventsRaw     = "events.raw"
	TopicAlertsPending = "alerts.pending"
	TopicAgentStatus   = "agent.status"
)

// Message is a generic queue message with a topic and payload.
type Message struct {
	Topic   string
	Payload []byte
}

// Publisher is the interface for publishing messages to the queue.
// Implementations: in-process (buffered channels), Redpanda.
type Publisher interface {
	Publish(msg Message) error
	Close() error
}
