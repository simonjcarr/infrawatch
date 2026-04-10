CREATE TABLE "domain_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"email" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"distinguished_name" text,
	"sam_account_name" text,
	"user_principal_name" text,
	"groups" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "ldap_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 389 NOT NULL,
	"use_tls" boolean DEFAULT false NOT NULL,
	"use_start_tls" boolean DEFAULT false NOT NULL,
	"base_dn" text NOT NULL,
	"bind_dn" text NOT NULL,
	"bind_password" text NOT NULL,
	"user_search_base" text,
	"user_search_filter" text DEFAULT '(uid={{username}})' NOT NULL,
	"group_search_base" text,
	"group_search_filter" text,
	"username_attribute" text DEFAULT 'uid' NOT NULL,
	"email_attribute" text DEFAULT 'mail' NOT NULL,
	"display_name_attribute" text DEFAULT 'cn' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_login" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"sync_interval_minutes" integer DEFAULT 60,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "domain_accounts" ADD CONSTRAINT "domain_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_configurations" ADD CONSTRAINT "ldap_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_accounts_org_source_username_idx" ON "domain_accounts" USING btree ("organisation_id","source","username");--> statement-breakpoint
CREATE INDEX "domain_accounts_org_status_idx" ON "domain_accounts" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "domain_accounts_org_source_idx" ON "domain_accounts" USING btree ("organisation_id","source");