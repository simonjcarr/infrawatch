package queries

import (
	"reflect"
	"testing"
)

func TestFilterHostIdentityIPsDropsHostLocalAndVirtualBridgeAddresses(t *testing.T) {
	t.Parallel()

	input := []string{
		"10.20.30.40",
		"172.17.0.1",
		"172.18.0.1",
		"172.20.5.1",
		"192.168.122.1",
		"192.168.8.1",
		"10.88.0.1",
		"10.20.30.1",
		"127.0.0.1",
		"::1",
		"169.254.10.20",
		"fe80::1",
		"10.20.30.40",
		"not-an-ip",
		"2001:4860:4860::8888",
	}

	got := FilterHostIdentityIPs(input)
	want := []string{"10.20.30.40", "2001:4860:4860::8888"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("FilterHostIdentityIPs() = %#v, want %#v", got, want)
	}
}

func TestFilterHostIdentityIPsKeepsNormalPrivateLANAddresses(t *testing.T) {
	t.Parallel()

	input := []string{
		"10.0.0.23",
		"172.20.5.23",
		"192.168.1.23",
	}

	got := FilterHostIdentityIPs(input)
	if !reflect.DeepEqual(got, input) {
		t.Fatalf("FilterHostIdentityIPs() = %#v, want %#v", got, input)
	}
}
