ALTER TABLE "service_accounts" ADD COLUMN "account_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD COLUMN "password_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD COLUMN "password_last_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_accounts" ADD COLUMN "account_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_accounts" ADD COLUMN "password_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_accounts" ADD COLUMN "password_last_changed_at" timestamp with time zone;