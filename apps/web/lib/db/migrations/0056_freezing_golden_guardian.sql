CREATE TABLE "password_vault_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"vault_id" text NOT NULL,
	"encrypted_payload_envelope" jsonb NOT NULL,
	"encrypted_display_envelope" jsonb NOT NULL,
	"envelope_version" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_vault_key_epochs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"vault_id" text NOT NULL,
	"epoch_number" text NOT NULL,
	"wrap_version" text NOT NULL,
	"rotation_reason" text NOT NULL,
	"rotated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_vault_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"vault_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"wrapped_vault_key_envelope" jsonb NOT NULL,
	"key_epoch_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_vault_user_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key_envelope" jsonb NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"envelope_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"setup_completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_vaults" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"encrypted_display_envelope" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "licence_verifier_public_key" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "licence_verifier_public_key_fingerprint" text;--> statement-breakpoint
ALTER TABLE "password_vault_entries" ADD CONSTRAINT "password_vault_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_entries" ADD CONSTRAINT "password_vault_entries_vault_id_password_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."password_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_entries" ADD CONSTRAINT "password_vault_entries_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_entries" ADD CONSTRAINT "password_vault_entries_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_entries" ADD CONSTRAINT "password_vault_entries_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_key_epochs" ADD CONSTRAINT "password_vault_key_epochs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_key_epochs" ADD CONSTRAINT "password_vault_key_epochs_vault_id_password_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."password_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_key_epochs" ADD CONSTRAINT "password_vault_key_epochs_rotated_by_user_id_user_id_fk" FOREIGN KEY ("rotated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_members" ADD CONSTRAINT "password_vault_members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_members" ADD CONSTRAINT "password_vault_members_vault_id_password_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."password_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_members" ADD CONSTRAINT "password_vault_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_members" ADD CONSTRAINT "password_vault_members_key_epoch_id_password_vault_key_epochs_id_fk" FOREIGN KEY ("key_epoch_id") REFERENCES "public"."password_vault_key_epochs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_members" ADD CONSTRAINT "password_vault_members_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_members" ADD CONSTRAINT "password_vault_members_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_members" ADD CONSTRAINT "password_vault_members_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vault_user_keys" ADD CONSTRAINT "password_vault_user_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vaults" ADD CONSTRAINT "password_vaults_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vaults" ADD CONSTRAINT "password_vaults_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vaults" ADD CONSTRAINT "password_vaults_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_vaults" ADD CONSTRAINT "password_vaults_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_vault_entries_org_vault_updated_idx" ON "password_vault_entries" USING btree ("organisation_id","vault_id","updated_at");--> statement-breakpoint
CREATE INDEX "password_vault_entries_vault_deleted_idx" ON "password_vault_entries" USING btree ("vault_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_vault_key_epochs_vault_epoch_uidx" ON "password_vault_key_epochs" USING btree ("vault_id","epoch_number");--> statement-breakpoint
CREATE INDEX "password_vault_key_epochs_org_vault_idx" ON "password_vault_key_epochs" USING btree ("organisation_id","vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_vault_members_vault_user_uidx" ON "password_vault_members" USING btree ("vault_id","user_id");--> statement-breakpoint
CREATE INDEX "password_vault_members_org_vault_idx" ON "password_vault_members" USING btree ("organisation_id","vault_id");--> statement-breakpoint
CREATE INDEX "password_vault_members_user_idx" ON "password_vault_members" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_vault_user_keys_user_uidx" ON "password_vault_user_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_vaults_org_status_idx" ON "password_vaults" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "password_vaults_org_updated_idx" ON "password_vaults" USING btree ("organisation_id","updated_at");
