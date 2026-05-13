CREATE TABLE "docker_container_metrics" (
	"id" text NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"docker_container_row_id" text NOT NULL,
	"docker_container_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"cpu_percent" double precision,
	"memory_usage_bytes" bigint,
	"memory_limit_bytes" bigint,
	"memory_percent" double precision,
	"network_rx_bytes" bigint,
	"network_tx_bytes" bigint,
	"block_read_bytes" bigint,
	"block_write_bytes" bigint,
	"pids_current" integer,
	"restart_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_container_metrics_id_recorded_at_pk" PRIMARY KEY("id","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "docker_telemetry_batches" (
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"sequence" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"inventory_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docker_container_metrics" ADD CONSTRAINT "docker_container_metrics_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_container_metrics" ADD CONSTRAINT "docker_container_metrics_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_container_metrics" ADD CONSTRAINT "docker_container_metrics_docker_container_row_id_docker_containers_id_fk" FOREIGN KEY ("docker_container_row_id") REFERENCES "public"."docker_containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_telemetry_batches" ADD CONSTRAINT "docker_telemetry_batches_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_telemetry_batches" ADD CONSTRAINT "docker_telemetry_batches_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "docker_container_metrics_instance_host_time_idx" ON "docker_container_metrics" USING btree ("instance_id","host_id","recorded_at");--> statement-breakpoint
CREATE INDEX "docker_container_metrics_instance_container_time_idx" ON "docker_container_metrics" USING btree ("instance_id","docker_container_row_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "docker_telemetry_batches_host_batch_uidx" ON "docker_telemetry_batches" USING btree ("host_id","batch_id");--> statement-breakpoint
CREATE INDEX "docker_telemetry_batches_received_idx" ON "docker_telemetry_batches" USING btree ("received_at");
