module github.com/carrtech-dev/ct-ops/agent

go 1.25.0

require (
	github.com/BurntSushi/toml v1.6.0
	github.com/carrtech-dev/ct-ops/proto v0.0.0
	github.com/pavlo-v-chernykh/keystore-go/v4 v4.5.0
	golang.org/x/crypto v0.51.0
	golang.org/x/sys v0.44.0
	google.golang.org/grpc v1.81.0
	google.golang.org/protobuf v1.36.11
)

require (
	golang.org/x/net v0.53.0 // indirect
	golang.org/x/text v0.37.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260226221140-a57be14db171 // indirect
)

// Local workspace module — resolved via go.work in the repo root.
replace github.com/carrtech-dev/ct-ops/proto => ../proto/gen/go
