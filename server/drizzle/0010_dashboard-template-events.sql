ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "template_events" jsonb DEFAULT '[]'::jsonb NOT NULL;
