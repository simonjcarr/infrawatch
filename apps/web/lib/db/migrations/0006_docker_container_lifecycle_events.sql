CREATE TABLE "docker_container_lifecycle_events" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"docker_container_row_id" text NOT NULL,
	"docker_container_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"primary_name" text,
	"image" text,
	"state" text,
	"status" text,
	"restart_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docker_container_lifecycle_events" ADD CONSTRAINT "docker_container_lifecycle_events_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_container_lifecycle_events" ADD CONSTRAINT "docker_container_lifecycle_events_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_container_lifecycle_events" ADD CONSTRAINT "docker_container_lifecycle_events_docker_container_row_id_docker_containers_id_fk" FOREIGN KEY ("docker_container_row_id") REFERENCES "public"."docker_containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "docker_container_lifecycle_events_host_event_uidx" ON "docker_container_lifecycle_events" USING btree ("host_id","docker_container_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "docker_container_lifecycle_events_org_host_time_idx" ON "docker_container_lifecycle_events" USING btree ("instance_id","host_id","occurred_at");--> statement-breakpoint
CREATE INDEX "docker_container_lifecycle_events_org_container_time_idx" ON "docker_container_lifecycle_events" USING btree ("instance_id","docker_container_row_id","occurred_at");
