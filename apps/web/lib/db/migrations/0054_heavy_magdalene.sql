ALTER TABLE "host_vulnerability_findings" DROP CONSTRAINT IF EXISTS "host_vuln_findings_affected_fk";
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" DROP CONSTRAINT IF EXISTS "host_vulnerability_findings_affected_package_id_vulnerability_affected_packages_id_fk";
--> statement-breakpoint
ALTER TABLE "host_vulnerability_findings" DROP COLUMN "affected_package_id";--> statement-breakpoint
DROP TABLE "vulnerability_affected_packages";--> statement-breakpoint
DROP TABLE "vulnerability_sources";
