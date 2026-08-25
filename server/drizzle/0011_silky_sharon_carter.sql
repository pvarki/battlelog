CREATE TYPE "public"."ingest_kind" AS ENUM('tak', 'matrix');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_cursors" (
	"source" text PRIMARY KEY NOT NULL,
	"cursor" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "ingest_kind" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"uuid" text PRIMARY KEY NOT NULL,
	"callsign" text NOT NULL,
	"cert_cn" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_callsign_unique" UNIQUE("callsign")
);
