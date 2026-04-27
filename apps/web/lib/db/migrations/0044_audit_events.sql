CREATE TABLE "audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL REFERENCES "organisations"("id"),
  "actor_user_id" text NOT NULL REFERENCES "user"("id"),
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text,
  "summary" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "audit_events_org_time_idx" ON "audit_events" ("organisation_id","created_at");
CREATE INDEX "audit_events_actor_time_idx" ON "audit_events" ("actor_user_id","created_at");
CREATE INDEX "audit_events_target_time_idx" ON "audit_events" ("target_type","target_id","created_at");
