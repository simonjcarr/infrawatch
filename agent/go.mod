module github.com/infrawatch/agent

go 1.25.0

require (
	github.com/BurntSushi/toml v1.6.0
	github.com/creack/pty v1.1.24
	github.com/infrawatch/proto v0.0.0
	github.com/pavlo-v-chernykh/keystore-go/v4 v4.5.0
	golang.org/x/crypto v0.50.0
	golang.org/x/sys v0.43.0
	google.golang.org/grpc v1.80.0
	google.golang.org/protobuf v1.36.11
)

require (
	golang.org/x/net v0.52.0 // indirect
	golang.org/x/text v0.36.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260120221211-b8f7ae30c516 // indirect
)

// Local workspace module — resolved via go.work in the repo root.
replace github.com/infrawatch/proto => ../proto/gen/go
