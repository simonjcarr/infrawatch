CREATE INDEX IF NOT EXISTS "notifications_deleted_at_idx"
  ON "notifications" ("deleted_at")
  WHERE "deleted_at" IS NOT NULL;
