ALTER TABLE "software_packages" ADD COLUMN "distro_id" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "distro_version_id" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "distro_codename" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "distro_id_like" jsonb;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "source_name" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "source_version" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "package_epoch" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "package_release" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "repository" text;
--> statement-breakpoint
ALTER TABLE "software_packages" ADD COLUMN "origin" text;
--> statement-breakpoint
CREATE INDEX "sw_pkg_source_name_idx" ON "software_packages" USING btree ("source","distro_id","distro_codename","source_name");
--> statement-breakpoint
CREATE TABLE "vulnerability_cves" (
  "cve_id" text PRIMARY KEY NOT NULL,
  "title" text,
  "description" text,
  "severity" text DEFAULT 'unknown' NOT NULL,
  "cvss_score" real,
  "published_at" timestamp with time zone,
  "modified_at" timestamp with time zone,
  "rejected" boolean DEFAULT false NOT NULL,
  "known_exploited" boolean DEFAULT false NOT NULL,
  "kev_due_date" timestamp with time zone,
  "kev_vendor_project" text,
  "kev_product" text,
  "kev_required_action" text,
  "source" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vulnerability_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "etag" text,
  "last_modified" text,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_error" text,
  "records_upserted" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vulnerability_affected_packages" (
  "id" text PRIMARY KEY NOT NULL,
  "cve_id" text NOT NULL,
  "source" text NOT NULL,
  "distro_id" text NOT NULL,
  "distro_version_id" text,
  "distro_codename" text,
  "package_name" text NOT NULL,
  "source_package_name" text,
  "fixed_version" text,
  "affected_versions" jsonb,
  "repository" text,
  "severity" text DEFAULT 'unknown' NOT NULL,
  "package_state" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_vulnerability_findings" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "host_id" text NOT NULL,
  "software_package_id" text NOT NULL,
  "cve_id" text NOT NULL,
  "affected_package_id" text,
  "status" text DEFAULT 'open' NOT NULL,
  "package_name" text NOT NULL,
  "installed_version" text NOT NULL,
  "fixed_version" text,
  "source" text NOT NULL,
  "severity" text DEFAULT 'unknown' NOT NULL,
  "cvss_score" real,
  "known_exploited" boolean DEFAULT false NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vulnerability_affected_packages" ADD CONSTRAINT "vuln_affected_cve_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."vulnerability_cves"("cve_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vuln_findings_org_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vuln_findings_host_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vuln_findings_pkg_fk" FOREIGN KEY ("software_package_id") REFERENCES "public"."software_packages"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vuln_findings_cve_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."vulnerability_cves"("cve_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ADD CONSTRAINT "host_vuln_findings_affected_fk" FOREIGN KEY ("affected_package_id") REFERENCES "public"."vulnerability_affected_packages"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "vulnerability_cves_severity_idx" ON "vulnerability_cves" USING btree ("severity");
--> statement-breakpoint
CREATE INDEX "vulnerability_cves_kev_idx" ON "vulnerability_cves" USING btree ("known_exploited");
--> statement-breakpoint
CREATE UNIQUE INDEX "vuln_affected_pkg_uniq" ON "vulnerability_affected_packages" USING btree ("source","cve_id","distro_id","distro_version_id","distro_codename","package_name","fixed_version","repository");
--> statement-breakpoint
CREATE INDEX "vuln_affected_pkg_match_idx" ON "vulnerability_affected_packages" USING btree ("distro_id","distro_codename","package_name");
--> statement-breakpoint
CREATE INDEX "vuln_affected_pkg_cve_idx" ON "vulnerability_affected_packages" USING btree ("cve_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "host_vuln_findings_uniq" ON "host_vulnerability_findings" USING btree ("organisation_id","host_id","software_package_id","cve_id");
--> statement-breakpoint
CREATE INDEX "host_vuln_findings_org_status_idx" ON "host_vulnerability_findings" USING btree ("organisation_id","status","severity");
--> statement-breakpoint
CREATE INDEX "host_vuln_findings_host_status_idx" ON "host_vulnerability_findings" USING btree ("host_id","status");
--> statement-breakpoint
CREATE INDEX "host_vuln_findings_cve_idx" ON "host_vulnerability_findings" USING btree ("cve_id");
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_scoped_access ON "host_vulnerability_findings" USING (
  current_setting('app.organisation_id', true) IS NULL
  OR organisation_id = current_setting('app.organisation_id', true)
  OR organisation_id IS NULL
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NULL
  OR organisation_id = current_setting('app.organisation_id', true)
  OR organisation_id IS NULL
);
