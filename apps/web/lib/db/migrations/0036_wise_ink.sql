CREATE TABLE "note_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"note_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"note_id" text NOT NULL,
	"editor_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"note_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"tag_selector" jsonb,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"author_id" text NOT NULL,
	"last_edited_by_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_editor_id_user_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_targets" ADD CONSTRAINT "note_targets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_targets" ADD CONSTRAINT "note_targets_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_last_edited_by_id_user_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_reactions_unique_uidx" ON "note_reactions" USING btree ("note_id","user_id","reaction");--> statement-breakpoint
CREATE INDEX "note_reactions_note_idx" ON "note_reactions" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_revisions_note_created_idx" ON "note_revisions" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "note_targets_type_id_idx" ON "note_targets" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "note_targets_note_idx" ON "note_targets" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_targets_direct_unique_uidx" ON "note_targets" USING btree ("note_id","target_type","target_id") WHERE "note_targets"."target_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_org_active_updated_idx" ON "notes" USING btree ("organisation_id","deleted_at","updated_at");--> statement-breakpoint
CREATE INDEX "notes_author_idx" ON "notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "notes_search_vector_idx" ON "notes" USING gin ("search_vector");