CREATE TABLE "agent_enrolment_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"label" text NOT NULL,
	"token" text NOT NULL,
	"created_by_id" text NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"max_uses" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "agent_enrolment_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "agent_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"status" text NOT NULL,
	"actor_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"hostname" text NOT NULL,
	"public_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" text,
	"os" text,
	"arch" text,
	"last_heartbeat_at" timestamp with time zone,
	"approved_by_id" text,
	"approved_at" timestamp with time zone,
	"enrolment_token_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "agents_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"agent_id" text,
	"hostname" text NOT NULL,
	"display_name" text,
	"os" text,
	"os_version" text,
	"arch" text,
	"ip_addresses" jsonb,
	"cpu_percent" real,
	"memory_percent" real,
	"disk_percent" real,
	"uptime_seconds" integer,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "resource_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_enrolment_tokens" ADD CONSTRAINT "agent_enrolment_tokens_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrolment_tokens" ADD CONSTRAINT "agent_enrolment_tokens_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_enrolment_token_id_agent_enrolment_tokens_id_fk" FOREIGN KEY ("enrolment_token_id") REFERENCES "public"."agent_enrolment_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_tags_resource_idx" ON "resource_tags" USING btree ("resource_id","resource_type");--> statement-breakpoint
CREATE INDEX "resource_tags_org_kv_idx" ON "resource_tags" USING btree ("organisation_id","key","value");