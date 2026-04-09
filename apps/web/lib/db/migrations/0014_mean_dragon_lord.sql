CREATE TABLE "identity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"service_account_id" text,
	"ssh_key_id" text,
	"host_id" text NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text NOT NULL,
	"username" text NOT NULL,
	"uid" integer,
	"gid" integer,
	"home_directory" text,
	"shell" text,
	"account_type" text DEFAULT 'service' NOT NULL,
	"has_login_capability" boolean DEFAULT false NOT NULL,
	"has_running_processes" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"host_id" text NOT NULL,
	"service_account_id" text,
	"key_type" text DEFAULT 'unknown' NOT NULL,
	"bit_length" integer,
	"fingerprint_sha256" text NOT NULL,
	"comment" text,
	"file_path" text NOT NULL,
	"key_source" text DEFAULT 'authorized_keys' NOT NULL,
	"associated_username" text,
	"status" text DEFAULT 'active' NOT NULL,
	"key_age_seconds" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_ssh_key_id_ssh_keys_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_events_org_time_idx" ON "identity_events" USING btree ("organisation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_events_account_time_idx" ON "identity_events" USING btree ("service_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_events_key_time_idx" ON "identity_events" USING btree ("ssh_key_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_events_host_time_idx" ON "identity_events" USING btree ("host_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_accounts_identity_idx" ON "service_accounts" USING btree ("organisation_id","host_id","username");--> statement-breakpoint
CREATE INDEX "service_accounts_org_type_idx" ON "service_accounts" USING btree ("organisation_id","account_type");--> statement-breakpoint
CREATE INDEX "service_accounts_org_status_idx" ON "service_accounts" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "service_accounts_org_host_idx" ON "service_accounts" USING btree ("organisation_id","host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_keys_identity_idx" ON "ssh_keys" USING btree ("organisation_id","host_id","fingerprint_sha256","file_path");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_fingerprint_idx" ON "ssh_keys" USING btree ("organisation_id","fingerprint_sha256");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_type_idx" ON "ssh_keys" USING btree ("organisation_id","key_type");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_status_idx" ON "ssh_keys" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "ssh_keys_org_host_idx" ON "ssh_keys" USING btree ("organisation_id","host_id");--> statement-breakpoint
CREATE INDEX "ssh_keys_account_idx" ON "ssh_keys" USING btree ("service_account_id");