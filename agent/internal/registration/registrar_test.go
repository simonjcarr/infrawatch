package registration

import (
	"net"
	"testing"
)

func TestIsRegistrationIdentityInterfaceSkipsContainerBridgeInterfaces(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		want bool
	}{
		{name: "ens5", want: true},
		{name: "eth0", want: true},
		{name: "docker0", want: false},
		{name: "br-36a3ae6d4ea9", want: false},
		{name: "vethd3ba27c", want: false},
		{name: "virbr0", want: false},
		{name: "cni0", want: false},
		{name: "flannel.1", want: false},
		{name: "cali123456", want: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := isRegistrationIdentityInterface(net.Interface{
				Name:  tt.name,
				Flags: net.FlagUp,
			}); got != tt.want {
				t.Fatalf("isRegistrationIdentityInterface(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

func TestIsRegistrationIdentityIPSkipsWeakAddresses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		ip   string
		want bool
	}{
		{ip: "192.168.8.191", want: true},
		{ip: "fd6b:46a:a53d:4e78:5054:8ff:fe00:812", want: true},
		{ip: "127.0.0.1", want: false},
		{ip: "::1", want: false},
		{ip: "169.254.10.20", want: false},
		{ip: "fe80::1", want: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.ip, func(t *testing.T) {
			t.Parallel()

			parsed := net.ParseIP(tt.ip)
			if parsed == nil {
				t.Fatalf("test IP %q did not parse", tt.ip)
			}
			if got := isRegistrationIdentityIP(parsed); got != tt.want {
				t.Fatalf("isRegistrationIdentityIP(%q) = %v, want %v", tt.ip, got, tt.want)
			}
		})
	}
}
