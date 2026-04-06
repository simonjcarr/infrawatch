CREATE TABLE "host_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"cpu_percent" real,
	"memory_percent" real,
	"disk_percent" real,
	"uptime_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_metrics" ADD CONSTRAINT "host_metrics_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_metrics" ADD CONSTRAINT "host_metrics_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Convert to TimescaleDB hypertable and add 30-day retention policy.
-- Wrapped in DO so plain PostgreSQL deployments (without TimescaleDB) degrade gracefully.
DO $$
BEGIN
  PERFORM create_hypertable('host_metrics', 'recorded_at', if_not_exists => true);
  PERFORM add_retention_policy('host_metrics', INTERVAL '30 days', if_not_exists => true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'TimescaleDB not available, skipping hypertable creation: %', SQLERRM;
END $$;