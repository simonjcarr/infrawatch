CREATE TABLE "build_doc_asset_storage_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"provider" text DEFAULT 'filesystem' NOT NULL,
	"config" jsonb DEFAULT '{"provider":"filesystem"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_doc_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"build_doc_id" text NOT NULL,
	"section_id" text,
	"uploaded_by_id" text NOT NULL,
	"provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "build_doc_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"build_doc_id" text NOT NULL,
	"editor_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_doc_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"build_doc_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_snippet_id" text,
	"source_snippet_version" integer,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "build_doc_snippets" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"last_edited_by_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B') || setweight(to_tsvector('english', coalesce(category, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "build_doc_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_doc_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "build_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"author_id" text NOT NULL,
	"last_edited_by_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"host_name" text,
	"customer_name" text,
	"project_name" text,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(host_name, '')), 'B') || setweight(to_tsvector('english', coalesce(customer_name, '')), 'B') || setweight(to_tsvector('english', coalesce(project_name, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "build_doc_asset_storage_settings" ADD CONSTRAINT "build_doc_asset_storage_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_asset_storage_settings" ADD CONSTRAINT "build_doc_asset_storage_settings_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_build_doc_id_build_docs_id_fk" FOREIGN KEY ("build_doc_id") REFERENCES "public"."build_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_section_id_build_doc_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."build_doc_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_assets" ADD CONSTRAINT "build_doc_assets_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_revisions" ADD CONSTRAINT "build_doc_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_revisions" ADD CONSTRAINT "build_doc_revisions_build_doc_id_build_docs_id_fk" FOREIGN KEY ("build_doc_id") REFERENCES "public"."build_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_revisions" ADD CONSTRAINT "build_doc_revisions_editor_id_user_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_sections" ADD CONSTRAINT "build_doc_sections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_sections" ADD CONSTRAINT "build_doc_sections_build_doc_id_build_docs_id_fk" FOREIGN KEY ("build_doc_id") REFERENCES "public"."build_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_sections" ADD CONSTRAINT "build_doc_sections_source_snippet_id_build_doc_snippets_id_fk" FOREIGN KEY ("source_snippet_id") REFERENCES "public"."build_doc_snippets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_snippets" ADD CONSTRAINT "build_doc_snippets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_snippets" ADD CONSTRAINT "build_doc_snippets_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_snippets" ADD CONSTRAINT "build_doc_snippets_last_edited_by_id_user_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_template_versions" ADD CONSTRAINT "build_doc_template_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_template_versions" ADD CONSTRAINT "build_doc_template_versions_template_id_build_doc_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."build_doc_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_template_versions" ADD CONSTRAINT "build_doc_template_versions_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_templates" ADD CONSTRAINT "build_doc_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_doc_templates" ADD CONSTRAINT "build_doc_templates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_template_version_id_build_doc_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."build_doc_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_docs" ADD CONSTRAINT "build_docs_last_edited_by_id_user_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_asset_storage_settings_org_uidx" ON "build_doc_asset_storage_settings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "build_doc_assets_doc_idx" ON "build_doc_assets" USING btree ("build_doc_id","deleted_at");--> statement-breakpoint
CREATE INDEX "build_doc_assets_section_idx" ON "build_doc_assets" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_assets_storage_key_uidx" ON "build_doc_assets" USING btree ("provider","storage_key");--> statement-breakpoint
CREATE INDEX "build_doc_revisions_doc_created_idx" ON "build_doc_revisions" USING btree ("build_doc_id","created_at");--> statement-breakpoint
CREATE INDEX "build_doc_sections_doc_position_idx" ON "build_doc_sections" USING btree ("build_doc_id","position");--> statement-breakpoint
CREATE INDEX "build_doc_sections_org_idx" ON "build_doc_sections" USING btree ("organisation_id","deleted_at");--> statement-breakpoint
CREATE INDEX "build_doc_sections_search_vector_idx" ON "build_doc_sections" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "build_doc_snippets_org_updated_idx" ON "build_doc_snippets" USING btree ("organisation_id","deleted_at","updated_at");--> statement-breakpoint
CREATE INDEX "build_doc_snippets_search_vector_idx" ON "build_doc_snippets" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_template_versions_template_version_uidx" ON "build_doc_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "build_doc_template_versions_org_idx" ON "build_doc_template_versions" USING btree ("organisation_id","template_id");--> statement-breakpoint
CREATE INDEX "build_doc_templates_org_active_idx" ON "build_doc_templates" USING btree ("organisation_id","deleted_at","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "build_doc_templates_default_uidx" ON "build_doc_templates" USING btree ("organisation_id","is_default") WHERE "build_doc_templates"."is_default" = TRUE AND "build_doc_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "build_docs_org_updated_idx" ON "build_docs" USING btree ("organisation_id","deleted_at","updated_at");--> statement-breakpoint
CREATE INDEX "build_docs_template_idx" ON "build_docs" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "build_docs_status_idx" ON "build_docs" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "build_docs_search_vector_idx" ON "build_docs" USING gin ("search_vector");--> statement-breakpoint
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT
      quote_ident(c.table_schema) AS schema_name,
      quote_ident(c.table_name) AS table_name
    FROM information_schema.columns c
    INNER JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organisation_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name LIKE 'build_doc%'
    GROUP BY c.table_schema, c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %s.%s ENABLE ROW LEVEL SECURITY', target.schema_name, target.table_name);
    EXECUTE format('ALTER TABLE %s.%s FORCE ROW LEVEL SECURITY', target.schema_name, target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS org_scoped_access ON %s.%s', target.schema_name, target.table_name);
    EXECUTE format(
      'CREATE POLICY org_scoped_access ON %1$s.%2$s USING (
        current_setting(''app.organisation_id'', true) IS NULL
        OR organisation_id = current_setting(''app.organisation_id'', true)
        OR organisation_id IS NULL
      ) WITH CHECK (
        current_setting(''app.organisation_id'', true) IS NULL
        OR organisation_id = current_setting(''app.organisation_id'', true)
        OR organisation_id IS NULL
      )',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END
$$;
