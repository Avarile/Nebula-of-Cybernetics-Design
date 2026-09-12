-- Postgres has no implicit cast from an enum to varchar, so drizzle-kit's
-- generated statement fails with "column kind cannot be cast automatically".
-- The USING clause is the hint it suggests.
ALTER TABLE "scheduled_job" ALTER COLUMN "kind" SET DATA TYPE varchar(120) USING "kind"::varchar(120);--> statement-breakpoint
ALTER TABLE "scheduled_job" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_job" ALTER COLUMN "occurrence_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_job" ALTER COLUMN "event_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_job" ADD COLUMN "subject_type" varchar(60);--> statement-breakpoint
ALTER TABLE "scheduled_job" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
CREATE INDEX "scheduled_job_subject_idx" ON "scheduled_job" USING btree ("subject_type","subject_id");--> statement-breakpoint
DROP TYPE "public"."scheduled_job_kind";
--> statement-breakpoint
-- Backfill the subject of the jobs that already exist, so "what is scheduled
-- for this thing?" answers the same way for rows written before and after this
-- migration. Without it the calendar's own jobs would be the one kind invisible
-- to the query added for every other module.
UPDATE "scheduled_job"
SET "subject_type" = 'calendar_event', "subject_id" = "event_id"
WHERE "event_id" IS NOT NULL AND "subject_type" IS NULL;
