CREATE INDEX "users_org_active_deleted_name_email_idx" ON "user" USING btree ("organisation_id","is_active","deleted_at","name","email");
