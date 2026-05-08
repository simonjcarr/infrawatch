CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"created_by" text,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"category" text DEFAULT 'maintenance' NOT NULL,
	"recurrence_rule" jsonb,
	"series_id" text,
	"recurrence_instance_start_at" timestamp with time zone,
	"exception_type" text,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_event_hosts" (
	"organisation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"host_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_hosts_pk" PRIMARY KEY("event_id","host_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_event_participants" (
	"organisation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_participants_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_event_hosts" ADD CONSTRAINT "calendar_event_hosts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_event_hosts" ADD CONSTRAINT "calendar_event_hosts_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_event_hosts" ADD CONSTRAINT "calendar_event_hosts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "calendar_events_org_range_idx" ON "calendar_events" USING btree ("organisation_id","starts_at","ends_at");
--> statement-breakpoint
CREATE INDEX "calendar_events_org_series_idx" ON "calendar_events" USING btree ("organisation_id","series_id","recurrence_instance_start_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_org_client_request_idx" ON "calendar_events" USING btree ("organisation_id","client_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_org_series_occurrence_idx" ON "calendar_events" USING btree ("organisation_id","series_id","recurrence_instance_start_at") WHERE "calendar_events"."series_id" IS NOT NULL AND "calendar_events"."recurrence_instance_start_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "calendar_event_hosts_org_host_idx" ON "calendar_event_hosts" USING btree ("organisation_id","host_id");
--> statement-breakpoint
CREATE INDEX "calendar_event_participants_org_user_idx" ON "calendar_event_participants" USING btree ("organisation_id","user_id");
--> statement-breakpoint
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.calendar_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_scoped_access ON public.calendar_events USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
);
--> statement-breakpoint
ALTER TABLE public.calendar_event_hosts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.calendar_event_hosts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_scoped_access ON public.calendar_event_hosts USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
);
--> statement-breakpoint
ALTER TABLE public.calendar_event_participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.calendar_event_participants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_scoped_access ON public.calendar_event_participants USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND organisation_id = current_setting('app.organisation_id', true)
);
