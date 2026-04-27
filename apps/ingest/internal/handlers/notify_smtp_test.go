package handlers

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
)

type smtpTestMessage struct {
	from string
	to   []string
	data string
}

func startMockSMTPServer(t *testing.T) (addr string, messages *[]smtpTestMessage, closeFn func()) {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	var mu sync.Mutex
	var captured []smtpTestMessage
	done := make(chan struct{})

	go func() {
		defer close(done)
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		reader := bufio.NewReader(conn)
		write := func(format string, args ...any) {
			_, _ = fmt.Fprintf(conn, format+"\r\n", args...)
		}
		write("220 mock.smtp ESMTP")

		current := smtpTestMessage{}
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")
			upper := strings.ToUpper(line)
			switch {
			case strings.HasPrefix(upper, "EHLO") || strings.HasPrefix(upper, "HELO"):
				write("250 mock.smtp")
			case strings.HasPrefix(upper, "MAIL FROM:"):
				current = smtpTestMessage{from: line}
				write("250 ok")
			case strings.HasPrefix(upper, "RCPT TO:"):
				current.to = append(current.to, line)
				write("250 ok")
			case upper == "DATA":
				write("354 end with dot")
				var b strings.Builder
				for {
					dataLine, err := reader.ReadString('\n')
					if err != nil {
						return
					}
					dataLine = strings.TrimRight(dataLine, "\r\n")
					if dataLine == "." {
						break
					}
					b.WriteString(dataLine)
					b.WriteByte('\n')
				}
				current.data = b.String()
				mu.Lock()
				captured = append(captured, current)
				mu.Unlock()
				write("250 queued")
			case upper == "QUIT":
				write("221 bye")
				return
			default:
				write("250 ok")
			}
		}
	}()

	return ln.Addr().String(), &captured, func() {
		_ = ln.Close()
		<-done
	}
}

func TestSendSmtpEmailDeliversToMockServer(t *testing.T) {
	addr, messages, closeFn := startMockSMTPServer(t)
	defer closeFn()

	host, portText, ok := strings.Cut(addr, ":")
	if !ok {
		t.Fatalf("unexpected addr %q", addr)
	}
	var port int
	if _, err := fmt.Sscanf(portText, "%d", &port); err != nil {
		t.Fatalf("parse port: %v", err)
	}

	err := sendSmtpEmail(smtpChannelConfig{
		Host:        host,
		Port:        port,
		Encryption:  "none",
		FromAddress: "alerts@example.com",
		FromName:    "CT-Ops Alerts",
		ToAddresses: []string{"ops@example.com", "team@example.com"},
	}, AlertEvent{
		Event:     "alert.test",
		Severity:  "info",
		Host:      "test-host",
		Rule:      "Test Rule",
		Message:   "SMTP delivery test",
		Timestamp: "2026-04-27T12:00:00Z",
	})
	if err != nil {
		t.Fatalf("sendSmtpEmail: %v", err)
	}

	if len(*messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(*messages))
	}
	msg := (*messages)[0]
	if !strings.Contains(msg.from, "alerts@example.com") {
		t.Fatalf("MAIL FROM did not include sender: %q", msg.from)
	}
	if len(msg.to) != 2 {
		t.Fatalf("expected 2 recipients, got %d", len(msg.to))
	}
	if !strings.Contains(msg.data, "[CT-Ops] TEST") {
		t.Fatalf("message did not include subject: %q", msg.data)
	}
	if !strings.Contains(msg.data, "SMTP delivery test") {
		t.Fatalf("message did not include body: %q", msg.data)
	}
}
