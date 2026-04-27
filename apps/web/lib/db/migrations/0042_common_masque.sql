ALTER TABLE "terminal_sessions" ADD COLUMN "websocket_token_hash" text;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD COLUMN "expires_at" timestamp with time zone;