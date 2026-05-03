ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "licence_verifier_public_key" text;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "licence_verifier_public_key_fingerprint" text;
