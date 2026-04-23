CREATE TABLE "certificate_authorities" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text,
	"purpose" text NOT NULL,
	"cert_pem" text NOT NULL,
	"key_pem_encrypted" text NOT NULL,
	"source" text NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "certificate_authorities_fingerprint_sha256_unique" UNIQUE("fingerprint_sha256")
);
--> statement-breakpoint
CREATE TABLE "revoked_certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"serial" text NOT NULL,
	"reason" text,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revoked_certificates_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
CREATE TABLE "pending_cert_signings" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"csr_der" "bytea" NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "client_cert_pem" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "client_cert_serial" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "client_cert_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "client_cert_not_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD CONSTRAINT "certificate_authorities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revoked_certificates" ADD CONSTRAINT "revoked_certificates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_cert_signings" ADD CONSTRAINT "pending_cert_signings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cert_authorities_purpose_idx" ON "certificate_authorities" USING btree ("purpose","deleted_at");--> statement-breakpoint
CREATE INDEX "revoked_certs_org_idx" ON "revoked_certificates" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "pending_cert_signings_requested_at_idx" ON "pending_cert_signings" USING btree ("requested_at");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_client_cert_serial_unique" UNIQUE("client_cert_serial");