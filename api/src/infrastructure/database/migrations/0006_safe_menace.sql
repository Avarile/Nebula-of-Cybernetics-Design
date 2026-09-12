CREATE TYPE "public"."agent_action_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_action_type" AS ENUM('send_email', 'db_write', 'external_api', 'other');--> statement-breakpoint
CREATE TYPE "public"."agent_approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_conversation_kind" AS ENUM('chat', 'scheduled', 'event');--> statement-breakpoint
CREATE TYPE "public"."agent_conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."agent_schedule_delivery" AS ENUM('conversation', 'email', 'none');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_run_trigger" AS ENUM('user_message', 'schedule', 'event', 'api');--> statement-breakpoint
CREATE TABLE "agent_action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"conversation_id" uuid,
	"actor_user_id" uuid,
	"action_type" "agent_action_type" NOT NULL,
	"tool_id" text NOT NULL,
	"status" "agent_action_status" NOT NULL,
	"summary" varchar(1000) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_id" uuid
);
--> statement-breakpoint
CREATE TABLE "agent_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"run_id" uuid NOT NULL,
	"conversation_id" uuid,
	"mastra_run_id" text,
	"tool_call_id" text,
	"suspend_path" text,
	"action_type" "agent_action_type" NOT NULL,
	"title" varchar(500) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "agent_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" varchar(1000),
	"expires_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"owner_user_id" uuid,
	"resource_id" text NOT NULL,
	"title" varchar(500),
	"kind" "agent_conversation_kind" DEFAULT 'chat' NOT NULL,
	"status" "agent_conversation_status" DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"conversation_id" uuid,
	"trigger" "agent_run_trigger" NOT NULL,
	"triggered_by_user_id" uuid,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"mastra_run_id" text,
	"agent_id" text NOT NULL,
	"model" text,
	"tokens_input" integer,
	"tokens_output" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"latency_ms" integer
);
--> statement-breakpoint
CREATE TABLE "agent_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(200) NOT NULL,
	"description" varchar(1000),
	"cron" varchar(120) NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"target_user_id" uuid,
	"agent_id" text NOT NULL,
	"prompt_template" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivery_channel" "agent_schedule_delivery" DEFAULT 'conversation' NOT NULL,
	"delivery_target" varchar(500),
	"last_run_at" timestamp with time zone,
	"last_run_status" varchar(40),
	"last_run_id" uuid,
	"next_run_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_action_log" ADD CONSTRAINT "agent_action_log_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_log" ADD CONSTRAINT "agent_action_log_approval_id_agent_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."agent_approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_action_log_run_idx" ON "agent_action_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_action_log_created_idx" ON "agent_action_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_action_log_type_idx" ON "agent_action_log" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "agent_approval_run_idx" ON "agent_approval" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_approval_conversation_idx" ON "agent_approval" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_approval_pending_idx" ON "agent_approval" USING btree ("status") WHERE "agent_approval"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "agent_conversation_owner_idx" ON "agent_conversation" USING btree ("owner_user_id") WHERE "agent_conversation"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "agent_conversation_resource_idx" ON "agent_conversation" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "agent_conversation_kind_status_idx" ON "agent_conversation" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "agent_run_conversation_idx" ON "agent_run" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_run_status_idx" ON "agent_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_run_trigger_idx" ON "agent_run" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "agent_run_mastra_run_idx" ON "agent_run" USING btree ("mastra_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_schedule_name_idx" ON "agent_schedule" USING btree ("name") WHERE "agent_schedule"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "agent_schedule_enabled_idx" ON "agent_schedule" USING btree ("enabled") WHERE "agent_schedule"."is_deleted" = false;