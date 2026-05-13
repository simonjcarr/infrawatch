CREATE TABLE "docker_containers" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"host_id" text NOT NULL,
	"docker_container_id" text NOT NULL,
	"primary_name" text,
	"names_json" jsonb NOT NULL,
	"image" text,
	"image_id" text,
	"labels_json" jsonb NOT NULL,
	"state" text,
	"status" text,
	"created_at_source" timestamp with time zone,
	"started_at_source" timestamp with time zone,
	"finished_at_source" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_inventory_at" timestamp with time zone NOT NULL,
	"restart_count" integer,
	"is_present" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docker_containers" ADD CONSTRAINT "docker_containers_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_containers" ADD CONSTRAINT "docker_containers_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "docker_containers_host_container_uidx" ON "docker_containers" USING btree ("host_id","docker_container_id");--> statement-breakpoint
CREATE INDEX "docker_containers_instance_host_present_seen_idx" ON "docker_containers" USING btree ("instance_id","host_id","is_present","last_seen_at");--> statement-breakpoint
CREATE INDEX "docker_containers_instance_image_idx" ON "docker_containers" USING btree ("instance_id","image");
