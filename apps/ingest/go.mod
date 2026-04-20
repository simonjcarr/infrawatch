module github.com/infrawatch/ingest

go 1.25.0

require (
	github.com/coder/websocket v1.8.14
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/infrawatch/proto v0.0.0
	github.com/jackc/pgx/v5 v5.9.2
	github.com/robfig/cron/v3 v3.0.1
	google.golang.org/grpc v1.80.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	golang.org/x/net v0.52.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
	golang.org/x/text v0.36.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260120221211-b8f7ae30c516 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

// Local workspace module — resolved via go.work in the repo root.
replace github.com/infrawatch/proto => ../../proto/gen/go
