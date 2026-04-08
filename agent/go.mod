module github.com/infrawatch/agent

go 1.23

require (
	github.com/BurntSushi/toml v1.4.0
	github.com/infrawatch/proto v0.0.0
	golang.org/x/sys v0.28.0
	google.golang.org/grpc v1.68.0
)

require (
	golang.org/x/net v0.31.0 // indirect
	golang.org/x/text v0.21.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20241118233622-e639e219e697 // indirect
	google.golang.org/protobuf v1.35.2 // indirect
)

// Local workspace module — resolved via go.work in the repo root.
replace github.com/infrawatch/proto => ../proto/gen/go
