module github.com/infrawatch/agent

go 1.25.0

require (
	github.com/BurntSushi/toml v1.4.0
	github.com/infrawatch/proto v0.0.0
	github.com/pavlo-v-chernykh/keystore-go/v4 v4.5.0
	golang.org/x/crypto v0.31.0
	golang.org/x/sys v0.42.0
	google.golang.org/grpc v1.68.0
)

require (
	golang.org/x/net v0.33.0 // indirect
	golang.org/x/text v0.35.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20241118233622-e639e219e697 // indirect
	google.golang.org/protobuf v1.35.2 // indirect
)

// Local workspace module — resolved via go.work in the repo root.
replace github.com/infrawatch/proto => ../proto/gen/go
