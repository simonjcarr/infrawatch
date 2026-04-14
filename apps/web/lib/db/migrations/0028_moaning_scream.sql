CREATE TABLE "saved_software_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "software_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"architecture" text,
	"publisher" text,
	"source" text NOT NULL,
	"install_date" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"cve_matches" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "software_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text NOT NULL,
	"task_run_host_id" text,
	"status" text NOT NULL,
	"source" text,
	"package_count" integer DEFAULT 0 NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"removed_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_software_reports" ADD CONSTRAINT "saved_software_reports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_software_reports" ADD CONSTRAINT "saved_software_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_packages" ADD CONSTRAINT "software_packages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_packages" ADD CONSTRAINT "software_packages_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_scans" ADD CONSTRAINT "software_scans_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_scans" ADD CONSTRAINT "software_scans_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_scans" ADD CONSTRAINT "software_scans_task_run_host_id_task_run_hosts_id_fk" FOREIGN KEY ("task_run_host_id") REFERENCES "public"."task_run_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_sw_reports_user_idx" ON "saved_software_reports" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sw_pkg_uniq" ON "software_packages" USING btree ("organisation_id","host_id","name","version","architecture");--> statement-breakpoint
CREATE INDEX "sw_pkg_org_name_idx" ON "software_packages" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "sw_pkg_host_idx" ON "software_packages" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "sw_pkg_first_seen_idx" ON "software_packages" USING btree ("organisation_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "sw_scan_host_idx" ON "software_scans" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "sw_scan_org_idx" ON "software_scans" USING btree ("organisation_id","created_at");