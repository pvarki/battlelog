-- Concurrent boots double-seeded templates before this index existed; keep
-- the oldest copy of each name so the unique index can build.
DELETE FROM "dashboards" a USING "dashboards" b
  WHERE a."is_template" AND b."is_template" AND a."name" = b."name" AND a."id" > b."id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboards_template_name_unique" ON "dashboards" USING btree ("name") WHERE "dashboards"."is_template";
