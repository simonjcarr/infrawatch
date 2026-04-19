CREATE TABLE "product_tier_price" (
	"id" text PRIMARY KEY NOT NULL,
	"tier_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"interval" text NOT NULL,
	"currency" text NOT NULL,
	"unit_amount" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_tier" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"stripe_product_id" text NOT NULL,
	"tier_slug" text NOT NULL,
	"name" text NOT NULL,
	"tier_order" integer DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"stripe_metadata_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "product_tier_id" text;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "product_tier_price_id" text;--> statement-breakpoint
ALTER TABLE "licence" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "licence" ADD COLUMN "product_tier_id" text;--> statement-breakpoint
ALTER TABLE "product_tier_price" ADD CONSTRAINT "product_tier_price_tier_id_product_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."product_tier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tier" ADD CONSTRAINT "product_tier_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_tier_price_stripe_price_id" ON "product_tier_price" USING btree ("stripe_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_tier_price_tier_interval_currency" ON "product_tier_price" USING btree ("tier_id","interval","currency");--> statement-breakpoint
CREATE INDEX "idx_product_tier_price_tier_id" ON "product_tier_price" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_tier_stripe_product_id" ON "product_tier" USING btree ("stripe_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_tier_slug" ON "product_tier" USING btree ("product_id","tier_slug");--> statement-breakpoint
CREATE INDEX "idx_product_tier_product_id" ON "product_tier" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_slug" ON "product" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_product_active_order" ON "product" USING btree ("is_active","display_order");--> statement-breakpoint
CREATE INDEX "idx_product_search" ON "product" USING gin ("search_tsv");--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_product_tier_id_product_tier_id_fk" FOREIGN KEY ("product_tier_id") REFERENCES "public"."product_tier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_product_tier_price_id_product_tier_price_id_fk" FOREIGN KEY ("product_tier_price_id") REFERENCES "public"."product_tier_price"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence" ADD CONSTRAINT "licence_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence" ADD CONSTRAINT "licence_product_tier_id_product_tier_id_fk" FOREIGN KEY ("product_tier_id") REFERENCES "public"."product_tier"("id") ON DELETE no action ON UPDATE no action;