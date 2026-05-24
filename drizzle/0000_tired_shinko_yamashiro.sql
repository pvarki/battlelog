CREATE TYPE "public"."admiralty_credibility" AS ENUM('1', '2', '3', '4', '5', '6');--> statement-breakpoint
CREATE TYPE "public"."admiralty_reliability" AS ENUM('A', 'B', 'C', 'D', 'E', 'F');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"update_for" uuid,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"event_time" timestamp with time zone,
	"header" text NOT NULL,
	"tags" text[],
	"hcoe_domains" text[],
	"admiralty_reliability" "admiralty_reliability",
	"admiralty_accuracy" "admiralty_credibility",
	"location" text,
	"location_point" geometry(point),
	"input_source" text,
	"source_uri" text,
	"type" text,
	"data" jsonb,
	CONSTRAINT "events_update_for_unique" UNIQUE("update_for"),
	CONSTRAINT "events_id_event_id_unique" UNIQUE("id","event_id"),
	CONSTRAINT "events_root_check" CHECK ("events"."update_for" IS NOT NULL OR "events"."event_id" = "events"."id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_chain_fk" FOREIGN KEY ("update_for","event_id") REFERENCES "public"."events"("id","event_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_event_id_idx" ON "events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_event_time_idx" ON "events" USING btree ("event_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_created_at_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_tags_gin_idx" ON "events" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_hcoe_domains_gin_idx" ON "events" USING gin ("hcoe_domains");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_created_by_idx" ON "events" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_location_point_gix" ON "events" USING gist ("location_point");
