CREATE TABLE "support_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text,
	"message_id" text,
	"uploaded_by_user_id" text NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_ticket_id_support_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_message_id_support_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."support_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_attachment_ticket_idx" ON "support_attachment" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_attachment_message_idx" ON "support_attachment" USING btree ("message_id");