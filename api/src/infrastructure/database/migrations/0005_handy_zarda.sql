CREATE TYPE "public"."search_index_state" AS ENUM('PENDING', 'INDEXED', 'FAILED');--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" varchar(500),
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"collection" varchar(100) NOT NULL,
	"external_id" varchar(255),
	"document" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"index_state" "search_index_state" DEFAULT 'PENDING' NOT NULL,
	"index_error" varchar(1000),
	"indexed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "collections_name_idx" ON "collections" USING btree ("name") WHERE "collections"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "search_records_collection_external_idx" ON "search_records" USING btree ("collection","external_id") WHERE "search_records"."external_id" IS NOT NULL AND "search_records"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "search_records_collection_deleted_idx" ON "search_records" USING btree ("collection","is_deleted");--> statement-breakpoint
CREATE INDEX "search_records_collection_state_idx" ON "search_records" USING btree ("collection","index_state");