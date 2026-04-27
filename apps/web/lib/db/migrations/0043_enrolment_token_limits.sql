-- Backfill legacy enrolment tokens so every live token has a hard usage cap
-- and expiry window. Existing tokens get one remaining use beyond their
-- current counter and a 30-day grace period if they never had an expiry.
UPDATE "agent_enrolment_tokens"
SET
  "max_uses" = COALESCE("max_uses", GREATEST("usage_count" + 1, 1)),
  "expires_at" = COALESCE("expires_at", NOW() + INTERVAL '30 days'),
  "updated_at" = NOW()
WHERE "deleted_at" IS NULL
  AND ("max_uses" IS NULL OR "expires_at" IS NULL);
