CREATE TABLE "host_patch_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text NOT NULL,
	"check_id" text,
	"status" text NOT NULL,
	"last_patched_at" timestamp with time zone,
	"patch_age_days" integer,
	"max_age_days" integer DEFAULT 30 NOT NULL,
	"package_manager" text,
	"updates_supported" boolean DEFAULT false NOT NULL,
	"updates_count" integer DEFAULT 0 NOT NULL,
	"updates_truncated" boolean DEFAULT false NOT NULL,
	"warnings" jsonb,
	"error" text,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_package_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text NOT NULL,
	"name" text NOT NULL,
	"current_version" text,
	"available_version" text,
	"architecture" text,
	"repository" text,
	"package_manager" text,
	"status" text DEFAULT 'current' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_patch_statuses" ADD CONSTRAINT "host_patch_statuses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_patch_statuses" ADD CONSTRAINT "host_patch_statuses_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_patch_statuses" ADD CONSTRAINT "host_patch_statuses_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_package_updates" ADD CONSTRAINT "host_package_updates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_package_updates" ADD CONSTRAINT "host_package_updates_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "host_patch_statuses_check_uniq" ON "host_patch_statuses" USING btree ("check_id");
--> statement-breakpoint
CREATE INDEX "host_patch_statuses_org_status_idx" ON "host_patch_statuses" USING btree ("organisation_id","status");
--> statement-breakpoint
CREATE INDEX "host_patch_statuses_host_checked_idx" ON "host_patch_statuses" USING btree ("host_id","checked_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "host_package_updates_current_uniq" ON "host_package_updates" USING btree ("organisation_id","host_id","name","current_version","available_version","architecture","package_manager");
--> statement-breakpoint
CREATE INDEX "host_package_updates_org_status_idx" ON "host_package_updates" USING btree ("organisation_id","status");
--> statement-breakpoint
CREATE INDEX "host_package_updates_host_status_idx" ON "host_package_updates" USING btree ("host_id","status");
--> statement-breakpoint
ALTER TABLE "host_patch_statuses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "host_patch_statuses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_scoped_access ON "host_patch_statuses" USING (
  current_setting('app.organisation_id', true) IS NULL
  OR organisation_id = current_setting('app.organisation_id', true)
  OR organisation_id IS NULL
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NULL
  OR organisation_id = current_setting('app.organisation_id', true)
  OR organisation_id IS NULL
);
--> statement-breakpoint
ALTER TABLE "host_package_updates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "host_package_updates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_scoped_access ON "host_package_updates" USING (
  current_setting('app.organisation_id', true) IS NULL
  OR organisation_id = current_setting('app.organisation_id', true)
  OR organisation_id IS NULL
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NULL
  OR organisation_id = current_setting('app.organisation_id', true)
  OR organisation_id IS NULL
);
