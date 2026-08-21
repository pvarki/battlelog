CREATE TABLE IF NOT EXISTS "dashboards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
