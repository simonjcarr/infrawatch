CREATE TABLE "ansible_credential_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"private_key_encrypted" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ansible_credential_profiles" ADD CONSTRAINT "ansible_credential_profiles_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ansible_credential_profiles" ADD CONSTRAINT "ansible_credential_profiles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ansible_credential_profiles_instance_idx" ON "ansible_credential_profiles" USING btree ("instance_id","name");