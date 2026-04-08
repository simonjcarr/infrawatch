CREATE TABLE "certificate_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"certificate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"discovered_by_host_id" text,
	"check_id" text,
	"source" text DEFAULT 'discovered' NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"server_name" text NOT NULL,
	"common_name" text NOT NULL,
	"issuer" text NOT NULL,
	"sans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"details" jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "certificate_events" ADD CONSTRAINT "certificate_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_events" ADD CONSTRAINT "certificate_events_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_discovered_by_host_id_hosts_id_fk" FOREIGN KEY ("discovered_by_host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cert_events_cert_time_idx" ON "certificate_events" USING btree ("certificate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cert_events_org_time_idx" ON "certificate_events" USING btree ("organisation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_identity_idx" ON "certificates" USING btree ("organisation_id","host","port","server_name","fingerprint_sha256");--> statement-breakpoint
CREATE INDEX "certificates_org_expiry_idx" ON "certificates" USING btree ("organisation_id","not_after");--> statement-breakpoint
CREATE INDEX "certificates_org_status_idx" ON "certificates" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "certificates_org_host_idx" ON "certificates" USING btree ("organisation_id","discovered_by_host_id");