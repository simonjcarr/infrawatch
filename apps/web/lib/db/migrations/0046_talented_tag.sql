CREATE TABLE "security_throttles" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lockout_level" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_throttles_pk" PRIMARY KEY("scope","key")
);
