CREATE TABLE "module_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"module_type" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"contract_version" text NOT NULL,
	"auth_mode" text DEFAULT 'service-token-hmac' NOT NULL,
	"token_id" text,
	"token_secret_encrypted" text,
	"tls_mode" text DEFAULT 'public-ca' NOT NULL,
	"ca_certificate" text,
	"server_certificate_sha256" text,
	"timeout_ms" integer DEFAULT 5000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "module_connections" ADD CONSTRAINT "module_connections_instance_id_instance_settings_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_settings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "module_connections_instance_type_uniq" ON "module_connections" USING btree ("instance_id","module_type");
--> statement-breakpoint
CREATE INDEX "module_connections_instance_enabled_idx" ON "module_connections" USING btree ("instance_id","enabled");
--> statement-breakpoint
CREATE INDEX "module_connections_type_idx" ON "module_connections" USING btree ("module_type");
