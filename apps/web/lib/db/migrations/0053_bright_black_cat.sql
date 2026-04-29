ALTER TABLE "user" ADD COLUMN "roles" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "user"
SET "roles" = CASE
  WHEN "role" IN ('super_admin', 'org_admin', 'engineer', 'read_only') THEN jsonb_build_array("role")
  ELSE '[]'::jsonb
END
WHERE "roles" = '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "roles" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "invitations"
SET "roles" = CASE
  WHEN "role" IN ('super_admin', 'org_admin', 'engineer', 'read_only') THEN jsonb_build_array("role")
  ELSE '[]'::jsonb
END
WHERE "roles" = '[]'::jsonb;
