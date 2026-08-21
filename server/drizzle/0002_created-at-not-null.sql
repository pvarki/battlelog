UPDATE "events" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "created_at" SET NOT NULL;
