CREATE TABLE "ingest_server_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"hostname" text NOT NULL,
	"process_id" integer NOT NULL,
	"version" text,
	"started_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"active_requests" integer DEFAULT 0 NOT NULL,
	"messages_received_total" bigint DEFAULT 0 NOT NULL,
	"queue_depth" integer DEFAULT 0 NOT NULL,
	"queue_capacity" integer DEFAULT 0 NOT NULL,
	"goroutines" integer DEFAULT 0 NOT NULL,
	"heap_alloc_bytes" bigint DEFAULT 0 NOT NULL,
	"heap_sys_bytes" bigint DEFAULT 0 NOT NULL,
	"db_open_connections" integer DEFAULT 0 NOT NULL,
	"db_acquired_connections" integer DEFAULT 0 NOT NULL,
	"gc_pause_total_ns" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ingest_server_snapshots_server_time_idx" ON "ingest_server_snapshots" USING btree ("server_id","observed_at");
--> statement-breakpoint
CREATE INDEX "ingest_server_snapshots_observed_idx" ON "ingest_server_snapshots" USING btree ("observed_at");
