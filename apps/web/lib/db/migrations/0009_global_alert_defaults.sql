ALTER TABLE "alert_rules" ADD COLUMN "is_global_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX "alert_rules_org_global_idx" ON "alert_rules" USING btree ("organisation_id","is_global_default");
