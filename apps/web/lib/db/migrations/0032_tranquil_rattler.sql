ALTER TABLE "domain_accounts" DROP CONSTRAINT "domain_accounts_ldap_configuration_id_ldap_configurations_id_fk";
--> statement-breakpoint
DROP INDEX "domain_accounts_org_source_username_idx";--> statement-breakpoint
DROP INDEX "domain_accounts_org_source_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "domain_accounts_org_username_idx" ON "domain_accounts" USING btree ("organisation_id","username");--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "ldap_configuration_id";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "distinguished_name";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "sam_account_name";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "user_principal_name";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "groups";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "account_locked";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "password_last_changed_at";--> statement-breakpoint
ALTER TABLE "domain_accounts" DROP COLUMN "last_synced_at";--> statement-breakpoint
ALTER TABLE "ldap_configurations" DROP COLUMN "last_sync_at";--> statement-breakpoint
ALTER TABLE "ldap_configurations" DROP COLUMN "last_sync_status";--> statement-breakpoint
ALTER TABLE "ldap_configurations" DROP COLUMN "last_sync_error";--> statement-breakpoint
ALTER TABLE "ldap_configurations" DROP COLUMN "sync_interval_minutes";