ALTER TABLE "password_vault_key_epochs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "password_vault_key_epochs_vault_idempotency_uidx" ON "password_vault_key_epochs" USING btree ("vault_id","idempotency_key");
