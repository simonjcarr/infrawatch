CREATE TABLE "host_docker_status" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"runtime_version" text,
	"api_version" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_docker_status" ADD CONSTRAINT "host_docker_status_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_docker_status" ADD CONSTRAINT "host_docker_status_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_docker_status_host_uidx" ON "host_docker_status" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "host_docker_status_instance_status_checked_idx" ON "host_docker_status" USING btree ("instance_id","status","checked_at");
