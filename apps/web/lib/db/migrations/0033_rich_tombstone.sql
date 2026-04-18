ALTER TABLE "certificates" ADD COLUMN "tracked_url" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "refresh_interval_seconds" integer;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "last_refresh_error" text;--> statement-breakpoint
CREATE INDEX "certificates_refresh_due_idx" ON "certificates" USING btree ("tracked_url","last_refreshed_at");