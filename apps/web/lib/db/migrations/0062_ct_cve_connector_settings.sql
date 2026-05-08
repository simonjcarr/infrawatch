CREATE TABLE "ct_cve_connector_settings" (
	"organisation_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"name" text DEFAULT 'Primary CT-CVE' NOT NULL,
	"base_url" text NOT NULL,
	"inventory_token_id" text NOT NULL,
	"inventory_token_secret_encrypted" text NOT NULL,
	"ct_cve_token_id" text NOT NULL,
	"ct_cve_token_secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ct_cve_connector_settings" ADD CONSTRAINT "ct_cve_connector_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ct_cve_connector_settings_enabled_idx" ON "ct_cve_connector_settings" USING btree ("enabled");
--> statement-breakpoint
ALTER TABLE public.ct_cve_connector_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.ct_cve_connector_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS org_scoped_access ON public.ct_cve_connector_settings;
--> statement-breakpoint
CREATE POLICY org_scoped_access ON public.ct_cve_connector_settings USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
);
