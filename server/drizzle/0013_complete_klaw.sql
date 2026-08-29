ALTER TABLE "events" ADD COLUMN "ingest_source_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_ingest_source_idx" ON "events" USING btree ("ingest_source_id");