CREATE TABLE "ct_cve_service_nonces" (
	"token_id" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ct_cve_service_nonces_pk" PRIMARY KEY("token_id","nonce")
);
--> statement-breakpoint
CREATE INDEX "ct_cve_service_nonces_expires_at_idx" ON "ct_cve_service_nonces" USING btree ("expires_at");