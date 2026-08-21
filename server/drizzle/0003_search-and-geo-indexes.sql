-- search=… uses ILIKE '%term%', which no btree can serve; a trigram GIN makes it indexed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "events_header_trgm_idx" ON "events" USING gin ("header" gin_trgm_ops);--> statement-breakpoint
-- The geo filter runs ST_DWithin on location_point::geography; the plain geometry
-- GiST index (events_location_point_gix) can't serve that cast expression.
CREATE INDEX "events_location_point_geog_gix" ON "events" USING gist ((("location_point")::geography));
