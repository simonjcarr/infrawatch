package checks

import (
	"fmt"
	"net"
	"time"
)

// PortConfig is the JSON config for a port check.
type PortConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

func runPortCheck(cfg PortConfig) (status, output string) {
	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	conn, err := net.DialTimeout("tcp", address, 5*time.Second)
	if err != nil {
		return "fail", fmt.Sprintf("connection failed: %v", err)
	}
	conn.Close()
	return "pass", fmt.Sprintf("port %d reachable", cfg.Port)
}
