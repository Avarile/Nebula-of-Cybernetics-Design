CREATE TYPE "public"."calendar_event_status" AS ENUM('confirmed', 'tentative', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."calendar_recurrence_frequency" AS ENUM('none', 'daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."event_occurrence_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_kind" AS ENUM('event_reminder', 'event_start', 'event_end');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_status" AS ENUM('pending', 'claimed', 'done', 'skipped', 'failed', 'dead');--> statement-breakpoint
ALTER TYPE "public"."retention_entity_type" ADD VALUE 'scheduled_job';--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"owner_user_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" varchar(2000),
	"location" varchar(300),
	"status" "calendar_event_status" DEFAULT 'confirmed' NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"start_local" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"frequency" "calendar_recurrence_frequency" DEFAULT 'none' NOT NULL,
	"recurrence_interval" integer DEFAULT 1 NOT NULL,
	"by_weekday" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recurrence_count" integer,
	"recurrence_until_local" timestamp,
	"reminder_offsets_ms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"project_id" uuid,
	"materialized_through" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"original_start" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"start_local" timestamp NOT NULL,
	"end_local" timestamp NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" "event_occurrence_status" DEFAULT 'scheduled' NOT NULL,
	"is_override" boolean DEFAULT false NOT NULL,
	"title_override" varchar(300)
);
--> statement-breakpoint
CREATE TABLE "scheduled_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "scheduled_job_kind" NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"event_version" integer NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" "scheduled_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"claimed_by" varchar(120),
	"last_error" varchar(1000),
	"dedupe_key" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrence" ADD CONSTRAINT "event_occurrence_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrence" ADD CONSTRAINT "event_occurrence_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_job" ADD CONSTRAINT "scheduled_job_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_job" ADD CONSTRAINT "scheduled_job_occurrence_id_event_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."event_occurrence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_owner_idx" ON "calendar_event" USING btree ("owner_user_id","start_local");--> statement-breakpoint
CREATE INDEX "calendar_event_materialize_idx" ON "calendar_event" USING btree ("materialized_through") WHERE "calendar_event"."is_deleted" = false AND "calendar_event"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "calendar_event_project_idx" ON "calendar_event" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_occurrence_identity_idx" ON "event_occurrence" USING btree ("event_id","original_start");--> statement-breakpoint
CREATE INDEX "event_occurrence_owner_idx" ON "event_occurrence" USING btree ("owner_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_occurrence_event_idx" ON "event_occurrence" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE INDEX "scheduled_job_due_idx" ON "scheduled_job" USING btree ("run_at") WHERE "scheduled_job"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_job_dedupe_idx" ON "scheduled_job" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "scheduled_job_lease_idx" ON "scheduled_job" USING btree ("lease_expires_at") WHERE "scheduled_job"."status" = 'claimed';--> statement-breakpoint
CREATE INDEX "scheduled_job_event_idx" ON "scheduled_job" USING btree ("event_id","run_at");--> statement-breakpoint
CREATE INDEX "scheduled_job_occurrence_idx" ON "scheduled_job" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "scheduled_job_created_idx" ON "scheduled_job" USING btree ("created_at");--> statement-breakpoint
-- Storage parameters are not expressible in the Drizzle schema, and this one is
-- load-bearing. `scheduled_job` is high-churn: every row is updated two or three
-- times (claim, then done/skipped/failed) and the shipped autovacuum default
-- waits for 20% dead tuples before reclaiming. On the one table whose partial
-- index scans have to stay fast, that is exactly backwards — bloat accumulates
-- between vacuums and the poller slows down for reasons nothing in the
-- application explains. 2% keeps the working set tight.
ALTER TABLE "scheduled_job" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);
