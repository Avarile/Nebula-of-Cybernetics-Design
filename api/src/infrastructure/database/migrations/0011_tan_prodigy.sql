CREATE TYPE "public"."collection_visibility" AS ENUM('private', 'owner_scoped', 'shared');--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "visibility" "collection_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "owner_field" varchar(100);