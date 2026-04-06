CREATE TABLE "check_results" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"host_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"output" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text,
	"name" text NOT NULL,
	"check_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_results_check_idx" ON "check_results" USING btree ("check_id","ran_at");--> statement-breakpoint
CREATE INDEX "check_results_org_idx" ON "check_results" USING btree ("organisation_id","ran_at");--> statement-breakpoint
CREATE INDEX "checks_org_host_idx" ON "checks" USING btree ("organisation_id","host_id");
--> statement-breakpoint
-- Convert check_results to TimescaleDB hypertable and add 30-day retention policy.
-- Wrapped in DO so plain PostgreSQL deployments (without TimescaleDB) degrade gracefully.
DO $$
BEGIN
  PERFORM create_hypertable('check_results', 'ran_at', if_not_exists => true);
  PERFORM add_retention_policy('check_results', INTERVAL '30 days', if_not_exists => true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'TimescaleDB not available, skipping hypertable creation: %', SQLERRM;
END $$;