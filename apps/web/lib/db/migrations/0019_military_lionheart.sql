DROP INDEX "domain_accounts_org_source_username_idx";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "deleted_at";--> statement-breakpoint
CREATE UNIQUE INDEX "domain_accounts_org_source_username_idx" ON "domain_accounts" USING btree ("organisation_id","source","username");