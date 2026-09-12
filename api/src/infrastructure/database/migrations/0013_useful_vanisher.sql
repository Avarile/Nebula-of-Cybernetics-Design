CREATE TYPE "public"."event_severity" AS ENUM('debug', 'info', 'warn', 'error', 'critical');--> statement-breakpoint
CREATE TYPE "public"."retention_action" AS ENUM('purge', 'anonymize', 'archive');--> statement-breakpoint
CREATE TYPE "public"."retention_entity_type" AS ENUM('activity_log', 'system_event_log', 'notifications', 'notification_delivery_attempts', 'sessions', 'password_reset_codes', 'email_messages', 'search_records');--> statement-breakpoint
CREATE TYPE "public"."activity_entity_type" AS ENUM('project', 'task', 'goal', 'milestone', 'knowledge', 'contact', 'contact_company', 'invoice', 'transaction', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('user', 'service', 'system');--> statement-breakpoint
CREATE TYPE "public"."attachable_type" AS ENUM('project', 'task', 'knowledge', 'contact', 'contact_company', 'invoice', 'transaction');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('document', 'image', 'receipt', 'contract', 'other');--> statement-breakpoint
CREATE TYPE "public"."commentable_type" AS ENUM('project', 'task', 'goal', 'milestone', 'knowledge', 'contact', 'invoice');--> statement-breakpoint
CREATE TYPE "public"."tag_scope" AS ENUM('knowledge', 'contact', 'project', 'task', 'shared');--> statement-breakpoint
CREATE TYPE "public"."permission_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."dependency_type" AS ENUM('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish');--> statement-breakpoint
CREATE TYPE "public"."goal_direction" AS ENUM('increase', 'decrease', 'maintain');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('objective', 'key_result');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('draft', 'active', 'at_risk', 'achieved', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'in_progress', 'reached', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."priority_level" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."project_member_role" AS ENUM('owner', 'manager', 'contributor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'on_hold', 'completed', 'archived', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private', 'internal');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."watch_reason" AS ENUM('manual', 'assigned', 'commented', 'mentioned', 'reporter');--> statement-breakpoint
CREATE TYPE "public"."company_size" AS ENUM('micro', 'small', 'medium', 'large', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."contact_channel_kind" AS ENUM('email', 'phone', 'mobile', 'fax', 'website', 'linkedin', 'twitter', 'wechat', 'whatsapp', 'other');--> statement-breakpoint
CREATE TYPE "public"."contact_relationship_type" AS ENUM('colleague', 'reports_to', 'manages', 'spouse', 'family', 'friend', 'referred_by', 'introduced_by', 'advisor_to', 'other');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('manual', 'inbound_email', 'import', 'referral', 'website', 'agent');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('active', 'inactive', 'archived', 'do_not_contact');--> statement-breakpoint
CREATE TYPE "public"."contact_visibility" AS ENUM('private', 'shared');--> statement-breakpoint
CREATE TYPE "public"."interaction_direction" AS ENUM('inbound', 'outbound', 'internal');--> statement-breakpoint
CREATE TYPE "public"."interaction_kind" AS ENUM('email_in', 'email_out', 'call', 'meeting', 'note', 'task', 'other');--> statement-breakpoint
CREATE TYPE "public"."relationship_strength" AS ENUM('weak', 'moderate', 'strong');--> statement-breakpoint
CREATE TYPE "public"."grantee_type" AS ENUM('user', 'role', 'authenticated');--> statement-breakpoint
CREATE TYPE "public"."knowledge_contact_relation" AS ENUM('subject', 'author', 'source', 'expert', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."knowledge_format" AS ENUM('markdown', 'html', 'plain', 'link', 'file');--> statement-breakpoint
CREATE TYPE "public"."knowledge_permission" AS ENUM('read', 'comment', 'write', 'manage');--> statement-breakpoint
CREATE TYPE "public"."knowledge_status" AS ENUM('draft', 'in_review', 'published', 'archived', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."knowledge_visibility" AS ENUM('private', 'restricted', 'internal');--> statement-breakpoint
CREATE TYPE "public"."account_kind" AS ENUM('bank', 'cash', 'credit_card', 'receivable', 'payable', 'other');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('draft', 'active', 'closed', 'exceeded');--> statement-breakpoint
CREATE TYPE "public"."financial_category_kind" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'card', 'cash', 'cheque', 'other');--> statement-breakpoint
CREATE TYPE "public"."recurrence_frequency" AS ENUM('weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('draft', 'pending', 'cleared', 'reconciled', 'void');--> statement-breakpoint
CREATE TYPE "public"."knowledge_relation" AS ENUM('reference', 'requirement', 'deliverable', 'background');--> statement-breakpoint
CREATE TYPE "public"."project_contact_relationship" AS ENUM('client', 'stakeholder', 'vendor', 'partner', 'sponsor', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."notification_entity_type" AS ENUM('project', 'task', 'goal', 'milestone', 'knowledge', 'contact', 'invoice', 'budget', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_frequency" AS ENUM('immediate', 'hourly', 'daily', 'weekly', 'off');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'soft_bounce_repeated', 'complaint', 'unsubscribe', 'manual', 'invalid');--> statement-breakpoint
CREATE TABLE "data_retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"entity_type" "retention_entity_type" NOT NULL,
	"retention_days" integer NOT NULL,
	"action" "retention_action" DEFAULT 'purge' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" varchar(50),
	"last_deleted_count" integer,
	"description" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(120) NOT NULL,
	"description" varchar(500),
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"severity" "event_severity" DEFAULT 'info' NOT NULL,
	"source" varchar(100) NOT NULL,
	"event_key" varchar(120) NOT NULL,
	"message" varchar(1000) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" varchar(50),
	"entity_id" uuid,
	"correlation_id" varchar(64),
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "system_setting_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"setting_id" uuid NOT NULL,
	"key" varchar(150) NOT NULL,
	"old_value_json" jsonb,
	"new_value_json" jsonb,
	"changed_by" uuid,
	"reason" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" "actor_kind" DEFAULT 'user' NOT NULL,
	"actor_credential_id" uuid,
	"entity_type" "activity_entity_type" NOT NULL,
	"entity_id" uuid,
	"action" varchar(100) NOT NULL,
	"summary" varchar(500),
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"project_id" uuid,
	"request_id" varchar(64),
	"ip" varchar(45),
	"user_agent" varchar(512)
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"entity_type" "commentable_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"author_user_id" uuid,
	"author_kind" "actor_kind" DEFAULT 'user' NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entity_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"entity_type" "attachable_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"label" varchar(255),
	"kind" "attachment_kind" DEFAULT 'document' NOT NULL,
	"attached_by" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(80) NOT NULL,
	"label" varchar(120) NOT NULL,
	"scope" "tag_scope" DEFAULT 'shared' NOT NULL,
	"color" varchar(16),
	"description" varchar(500),
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(120) NOT NULL,
	"resource" varchar(60) NOT NULL,
	"action" varchar(40) NOT NULL,
	"description" varchar(500),
	"is_system" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"granted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"is_system" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"effect" "permission_effect" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"granted_by" uuid,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"key" varchar(150) NOT NULL,
	"value_json" jsonb NOT NULL,
	"type" "setting_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"first_name" varchar(120),
	"last_name" varchar(120),
	"avatar_file_id" uuid,
	"job_title" varchar(150),
	"department" varchar(150),
	"phone" varchar(40),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"locale" varchar(16) DEFAULT 'en' NOT NULL,
	"date_format" varchar(32),
	"time_format" varchar(32),
	"bio" varchar(2000),
	"contact_id" uuid,
	"onboarded_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" uuid,
	"parent_goal_id" uuid,
	"kind" "goal_kind" DEFAULT 'objective' NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"metric_name" varchar(120),
	"target_value" numeric(20, 4),
	"current_value" numeric(20, 4),
	"unit" varchar(40),
	"direction" "goal_direction",
	"start_date" date,
	"due_date" date,
	"achieved_at" timestamp with time zone,
	"progress_pct" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"due_date" date,
	"reached_at" timestamp with time zone,
	"owner_user_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_in_project" "project_member_role" DEFAULT 'contributor' NOT NULL,
	"added_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"tagged_by" uuid
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"priority" "priority_level" DEFAULT 'medium' NOT NULL,
	"owner_user_id" uuid,
	"lead_user_id" uuid,
	"parent_project_id" uuid,
	"visibility" "project_visibility" DEFAULT 'private' NOT NULL,
	"start_date" date,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"task_seq" integer DEFAULT 0 NOT NULL,
	"budget_amount" numeric(20, 4),
	"currency" varchar(3),
	"color" varchar(16),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"predecessor_task_id" uuid NOT NULL,
	"successor_task_id" uuid NOT NULL,
	"type" "dependency_type" DEFAULT 'finish_to_start' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "task_dependencies_no_self_ck" CHECK ("task_dependencies"."predecessor_task_id" <> "task_dependencies"."successor_task_id")
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"tagged_by" uuid
);
--> statement-breakpoint
CREATE TABLE "task_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" "watch_reason" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid,
	"parent_task_id" uuid,
	"number" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "priority_level" DEFAULT 'medium' NOT NULL,
	"assignee_user_id" uuid,
	"reporter_user_id" uuid,
	"estimate_minutes" integer,
	"spent_minutes" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"blocked_reason" varchar(500),
	"sort_rank" varchar(64),
	"external_ref" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"parent_id" uuid,
	"path" varchar(500) DEFAULT '/' NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"contact_id" uuid NOT NULL,
	"kind" "contact_channel_kind" NOT NULL,
	"value" varchar(320) NOT NULL,
	"label" varchar(60),
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"legal_name" varchar(255),
	"domain" varchar(255),
	"industry" varchar(120),
	"size" "company_size",
	"website" varchar(255),
	"phone" varchar(40),
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"country" varchar(2),
	"parent_company_id" uuid,
	"owner_user_id" uuid,
	"status" "contact_status" DEFAULT 'active' NOT NULL,
	"description" text,
	"logo_file_id" uuid,
	"tax_number" varchar(60),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"contact_id" uuid NOT NULL,
	"kind" "interaction_kind" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"subject" varchar(500),
	"body" text,
	"direction" "interaction_direction",
	"email_message_id" uuid,
	"project_id" uuid,
	"user_id" uuid,
	"duration_minutes" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"from_contact_id" uuid NOT NULL,
	"to_contact_id" uuid NOT NULL,
	"type" "contact_relationship_type" NOT NULL,
	"strength" "relationship_strength",
	"since" date,
	"note" varchar(500),
	"created_by" uuid,
	CONSTRAINT "contact_relationships_no_self_ck" CHECK ("contact_relationships"."from_contact_id" <> "contact_relationships"."to_contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"tagged_by" uuid
);
--> statement-breakpoint
CREATE TABLE "contact_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"color" varchar(16),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"first_name" varchar(120),
	"last_name" varchar(120),
	"display_name" varchar(255) NOT NULL,
	"salutation" varchar(40),
	"primary_email" varchar(320),
	"email_normalized" varchar(320),
	"primary_phone" varchar(40),
	"job_title" varchar(150),
	"company_id" uuid,
	"type_id" uuid,
	"category_id" uuid,
	"owner_user_id" uuid,
	"linked_user_id" uuid,
	"status" "contact_status" DEFAULT 'active' NOT NULL,
	"source" "contact_source" DEFAULT 'manual' NOT NULL,
	"visibility" "contact_visibility" DEFAULT 'private' NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"country" varchar(2),
	"timezone" varchar(64),
	"language" varchar(16),
	"birthday" date,
	"notes" text,
	"last_contacted_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"avatar_file_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" varchar(500) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"summary" varchar(1000),
	"body" text,
	"format" "knowledge_format" DEFAULT 'markdown' NOT NULL,
	"type_id" uuid,
	"category_id" uuid,
	"status" "knowledge_status" DEFAULT 'draft' NOT NULL,
	"visibility" "knowledge_visibility" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"owner_user_id" uuid,
	"author_user_id" uuid,
	"reviewer_user_id" uuid,
	"source_url" varchar(2000),
	"source_file_id" uuid,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"published_at" timestamp with time zone,
	"review_due_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_access_control" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"knowledge_id" uuid NOT NULL,
	"grantee_type" "grantee_type" NOT NULL,
	"grantee_user_id" uuid,
	"grantee_role_id" uuid,
	"permission" "knowledge_permission" DEFAULT 'read' NOT NULL,
	"granted_by" uuid,
	"expires_at" timestamp with time zone,
	CONSTRAINT "knowledge_acl_grantee_ck" CHECK (("knowledge_access_control"."grantee_type" = 'user' AND "knowledge_access_control"."grantee_user_id" IS NOT NULL AND "knowledge_access_control"."grantee_role_id" IS NULL)
       OR ("knowledge_access_control"."grantee_type" = 'role' AND "knowledge_access_control"."grantee_role_id" IS NOT NULL AND "knowledge_access_control"."grantee_user_id" IS NULL)
       OR ("knowledge_access_control"."grantee_type" = 'authenticated' AND "knowledge_access_control"."grantee_user_id" IS NULL AND "knowledge_access_control"."grantee_role_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "knowledge_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"parent_id" uuid,
	"path" varchar(500) DEFAULT '/' NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_contact_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"knowledge_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"relation" "knowledge_contact_relation" DEFAULT 'subject' NOT NULL,
	"note" varchar(500),
	"linked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "knowledge_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"knowledge_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"tagged_by" uuid
);
--> statement-breakpoint
CREATE TABLE "knowledge_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"icon" varchar(60),
	"color" varchar(16),
	"default_review_interval_days" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(150) NOT NULL,
	"project_id" uuid,
	"category_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"spent_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"alert_threshold_pct" integer DEFAULT 80 NOT NULL,
	"owner_user_id" uuid,
	"status" "budget_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"symbol" varchar(8),
	"minor_unit" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(150) NOT NULL,
	"kind" "account_kind" DEFAULT 'bank' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"opening_balance" numeric(20, 4) DEFAULT '0' NOT NULL,
	"current_balance" numeric(20, 4) DEFAULT '0' NOT NULL,
	"institution" varchar(150),
	"account_ref" varchar(120),
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" "financial_category_kind" NOT NULL,
	"description" varchar(500),
	"parent_id" uuid,
	"path" varchar(500) DEFAULT '/' NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_code" varchar(3) NOT NULL,
	"quote_code" varchar(3) NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"as_of" date NOT NULL,
	"source" varchar(80)
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"description" varchar(500) NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit" varchar(40),
	"unit_price" numeric(20, 4) NOT NULL,
	"tax_rate_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"tax_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	"task_id" uuid,
	"project_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"number" varchar(60) NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"project_id" uuid,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"subtotal" numeric(20, 4) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(20, 4) DEFAULT '0' NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"bill_to_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"terms" text,
	"pdf_file_id" uuid,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"transaction_id" uuid,
	"amount" numeric(20, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"reference" varchar(120),
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(150) NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"frequency" "recurrence_frequency" NOT NULL,
	"day_of_period" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_due_on" date,
	"last_generated_on" date,
	"account_id" uuid,
	"category_id" uuid,
	"project_id" uuid,
	"contact_id" uuid,
	"company_id" uuid,
	"auto_post" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" varchar(500),
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" "transaction_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"base_amount" numeric(20, 4),
	"fx_rate" numeric(20, 10),
	"fx_rate_at" date,
	"account_id" uuid NOT NULL,
	"counter_account_id" uuid,
	"category_id" uuid,
	"project_id" uuid,
	"task_id" uuid,
	"contact_id" uuid,
	"company_id" uuid,
	"invoice_id" uuid,
	"description" varchar(500) NOT NULL,
	"reference" varchar(120),
	"receipt_file_id" uuid,
	"status" "transaction_status" DEFAULT 'draft' NOT NULL,
	"reverses_transaction_id" uuid,
	"recurring_transaction_id" uuid,
	"created_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "transactions_amount_positive_ck" CHECK ("transactions"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_contact_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid,
	"relationship" "project_contact_relationship" DEFAULT 'stakeholder' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"note" varchar(500),
	"linked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "project_knowledge_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" uuid NOT NULL,
	"knowledge_id" uuid NOT NULL,
	"task_id" uuid,
	"relation" "knowledge_relation" DEFAULT 'reference' NOT NULL,
	"note" varchar(500),
	"linked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"task_id" uuid,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"minutes" integer NOT NULL,
	"work_date" date NOT NULL,
	"description" varchar(500),
	"is_billable" boolean DEFAULT false NOT NULL,
	"hourly_rate" numeric(20, 4),
	"currency" varchar(3),
	"invoice_line_item_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notification_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "notification_status" NOT NULL,
	"smtp_config_id" uuid,
	"response_code" varchar(20),
	"response_message" varchar(1000),
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "notification_event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(120) NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" varchar(500),
	"category" varchar(60) DEFAULT 'system' NOT NULL,
	"default_enabled" boolean DEFAULT true NOT NULL,
	"is_digestable" boolean DEFAULT true NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"default_template_key" varchar(120),
	"is_system" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"frequency" "notification_frequency" DEFAULT 'immediate' NOT NULL,
	"quiet_hours_start" integer,
	"quiet_hours_end" integer
);
--> statement-breakpoint
CREATE TABLE "notification_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"email" varchar(320) NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"event_type_id" uuid,
	"source" varchar(120),
	"expires_at" timestamp with time zone,
	"note" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(120) NOT NULL,
	"locale" varchar(16) DEFAULT 'en' NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" varchar(500),
	"subject_template" varchar(500) NOT NULL,
	"body_text_template" text NOT NULL,
	"body_html_template" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"recipient_user_id" uuid,
	"recipient_contact_id" uuid,
	"recipient_email" varchar(320) NOT NULL,
	"event_type_id" uuid NOT NULL,
	"template_id" uuid,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body_preview" varchar(1000),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" "notification_entity_type",
	"entity_id" uuid,
	"project_id" uuid,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"priority" "priority_level" DEFAULT 'medium' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(1000),
	"provider_message_id" varchar(255),
	"dedupe_key" varchar(255),
	"digest_group_key" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "is_editable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "default_json" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "validation_json" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_setting_revisions" ADD CONSTRAINT "system_setting_revisions_setting_id_system_settings_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."system_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_setting_revisions" ADD CONSTRAINT "system_setting_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_credential_id_service_credentials_id_fk" FOREIGN KEY ("actor_credential_id") REFERENCES "public"."service_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_attachments" ADD CONSTRAINT "entity_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_attachments" ADD CONSTRAINT "entity_attachments_attached_by_users_id_fk" FOREIGN KEY ("attached_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_avatar_file_id_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_goal_id_goals_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tagged_by_users_id_fk" FOREIGN KEY ("tagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_project_id_projects_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_predecessor_task_id_tasks_id_fk" FOREIGN KEY ("predecessor_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_successor_task_id_tasks_id_fk" FOREIGN KEY ("successor_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tagged_by_users_id_fk" FOREIGN KEY ("tagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_categories" ADD CONSTRAINT "contact_categories_parent_id_contact_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."contact_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_parent_company_id_contact_companies_id_fk" FOREIGN KEY ("parent_company_id") REFERENCES "public"."contact_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_from_contact_id_contacts_id_fk" FOREIGN KEY ("from_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_to_contact_id_contacts_id_fk" FOREIGN KEY ("to_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tagged_by_users_id_fk" FOREIGN KEY ("tagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_contact_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contact_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_type_id_contact_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."contact_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_category_id_contact_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."contact_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_avatar_file_id_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_type_id_knowledge_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."knowledge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_category_id_knowledge_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."knowledge_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_control" ADD CONSTRAINT "knowledge_access_control_knowledge_id_knowledge_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_control" ADD CONSTRAINT "knowledge_access_control_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_control" ADD CONSTRAINT "knowledge_access_control_grantee_role_id_roles_id_fk" FOREIGN KEY ("grantee_role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_control" ADD CONSTRAINT "knowledge_access_control_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_parent_id_knowledge_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_contact_links" ADD CONSTRAINT "knowledge_contact_links_knowledge_id_knowledge_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_contact_links" ADD CONSTRAINT "knowledge_contact_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_contact_links" ADD CONSTRAINT "knowledge_contact_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_tags" ADD CONSTRAINT "knowledge_tags_knowledge_id_knowledge_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_tags" ADD CONSTRAINT "knowledge_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_tags" ADD CONSTRAINT "knowledge_tags_tagged_by_users_id_fk" FOREIGN KEY ("tagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_financial_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_parent_id_financial_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."financial_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_contact_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contact_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_financial_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_company_id_contact_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contact_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_counter_account_id_financial_accounts_id_fk" FOREIGN KEY ("counter_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_financial_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_company_id_contact_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contact_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receipt_file_id_files_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reverses_transaction_id_transactions_id_fk" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contact_links" ADD CONSTRAINT "project_contact_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contact_links" ADD CONSTRAINT "project_contact_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contact_links" ADD CONSTRAINT "project_contact_links_company_id_contact_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contact_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contact_links" ADD CONSTRAINT "project_contact_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_links" ADD CONSTRAINT "project_knowledge_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_links" ADD CONSTRAINT "project_knowledge_links_knowledge_id_knowledge_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_links" ADD CONSTRAINT "project_knowledge_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_links" ADD CONSTRAINT "project_knowledge_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_line_item_id_invoice_line_items_id_fk" FOREIGN KEY ("invoice_line_item_id") REFERENCES "public"."invoice_line_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_smtp_config_id_smtp_configs_id_fk" FOREIGN KEY ("smtp_config_id") REFERENCES "public"."smtp_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_event_type_id_notification_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."notification_event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_suppressions" ADD CONSTRAINT "notification_suppressions_event_type_id_notification_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."notification_event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_contact_id_contacts_id_fk" FOREIGN KEY ("recipient_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_type_id_notification_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."notification_event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_id_notification_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_retention_entity_idx" ON "data_retention_policies" USING btree ("entity_type") WHERE "data_retention_policies"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_idx" ON "feature_flags" USING btree ("key") WHERE "feature_flags"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "system_event_log_severity_idx" ON "system_event_log" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX "system_event_log_key_idx" ON "system_event_log" USING btree ("event_key","created_at");--> statement-breakpoint
CREATE INDEX "system_event_log_correlation_idx" ON "system_event_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "system_event_log_created_idx" ON "system_event_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "system_setting_revisions_setting_idx" ON "system_setting_revisions" USING btree ("setting_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_project_idx" ON "activity_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_created_idx" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "comments" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_attachments_unique_idx" ON "entity_attachments" USING btree ("entity_type","entity_id","file_id") WHERE "entity_attachments"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "entity_attachments_entity_idx" ON "entity_attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_attachments_file_idx" ON "entity_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_scope_key_idx" ON "tags" USING btree ("scope","key") WHERE "tags"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "tags_scope_usage_idx" ON "tags" USING btree ("scope","usage_count");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_idx" ON "permissions" USING btree ("key") WHERE "permissions"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "permissions_resource_idx" ON "permissions" USING btree ("resource");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_pair_idx" ON "role_permissions" USING btree ("role_id","permission_id") WHERE "role_permissions"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_idx" ON "roles" USING btree ("key") WHERE "roles"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "user_permissions_pair_idx" ON "user_permissions" USING btree ("user_id","permission_id") WHERE "user_permissions"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "user_permissions_user_idx" ON "user_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_pair_idx" ON "user_roles" USING btree ("user_id","role_id") WHERE "user_roles"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_expiring_idx" ON "user_roles" USING btree ("expires_at") WHERE "user_roles"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_key_idx" ON "user_preferences" USING btree ("user_id","key") WHERE "user_preferences"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_user_idx" ON "user_profiles" USING btree ("user_id") WHERE "user_profiles"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "user_profiles_contact_idx" ON "user_profiles" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "goals_project_idx" ON "goals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "goals_parent_idx" ON "goals" USING btree ("parent_goal_id");--> statement-breakpoint
CREATE INDEX "goals_owner_status_idx" ON "goals" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "milestones" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "milestones_due_idx" ON "milestones" USING btree ("due_date") WHERE "milestones"."status" <> 'reached';--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_pair_idx" ON "project_members" USING btree ("project_id","user_id") WHERE "project_members"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_tags_pair_idx" ON "project_tags" USING btree ("project_id","tag_id") WHERE "project_tags"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "project_tags_tag_idx" ON "project_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_key_idx" ON "projects" USING btree ("key") WHERE "projects"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status") WHERE "projects"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "projects_parent_idx" ON "projects" USING btree ("parent_project_id");--> statement-breakpoint
CREATE INDEX "projects_due_idx" ON "projects" USING btree ("due_date") WHERE "projects"."status" = 'active';--> statement-breakpoint
CREATE INDEX "projects_unowned_idx" ON "projects" USING btree ("created_at") WHERE "projects"."owner_user_id" IS NULL AND "projects"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_pair_idx" ON "task_dependencies" USING btree ("predecessor_task_id","successor_task_id") WHERE "task_dependencies"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "task_dependencies_successor_idx" ON "task_dependencies" USING btree ("successor_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_tags_pair_idx" ON "task_tags" USING btree ("task_id","tag_id") WHERE "task_tags"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "task_tags_tag_idx" ON "task_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_watchers_pair_idx" ON "task_watchers" USING btree ("task_id","user_id") WHERE "task_watchers"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "task_watchers_user_idx" ON "task_watchers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_number_idx" ON "tasks" USING btree ("project_id","number") WHERE "tasks"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_milestone_idx" ON "tasks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_date") WHERE "tasks"."status" NOT IN ('done', 'cancelled');--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" USING btree ("project_id","status","sort_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_categories_key_idx" ON "contact_categories" USING btree ("key") WHERE "contact_categories"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "contact_categories_path_idx" ON "contact_categories" USING btree ("path");--> statement-breakpoint
CREATE INDEX "contact_categories_parent_idx" ON "contact_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_channels_value_idx" ON "contact_channels" USING btree ("contact_id","kind","value") WHERE "contact_channels"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_channels_primary_idx" ON "contact_channels" USING btree ("contact_id","kind") WHERE "contact_channels"."is_primary" = true AND "contact_channels"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "contact_channels_value_lookup_idx" ON "contact_channels" USING btree ("kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_companies_domain_idx" ON "contact_companies" USING btree ("domain") WHERE "contact_companies"."domain" IS NOT NULL AND "contact_companies"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "contact_companies_name_idx" ON "contact_companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "contact_companies_owner_idx" ON "contact_companies" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contact_companies_parent_idx" ON "contact_companies" USING btree ("parent_company_id");--> statement-breakpoint
CREATE INDEX "contact_interactions_contact_idx" ON "contact_interactions" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "contact_interactions_project_idx" ON "contact_interactions" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_interactions_email_idx" ON "contact_interactions" USING btree ("email_message_id") WHERE "contact_interactions"."email_message_id" IS NOT NULL AND "contact_interactions"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_relationships_edge_idx" ON "contact_relationships" USING btree ("from_contact_id","to_contact_id","type") WHERE "contact_relationships"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "contact_relationships_to_idx" ON "contact_relationships" USING btree ("to_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tags_pair_idx" ON "contact_tags" USING btree ("contact_id","tag_id") WHERE "contact_tags"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "contact_tags_tag_idx" ON "contact_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_types_key_idx" ON "contact_types" USING btree ("key") WHERE "contact_types"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_normalized_idx" ON "contacts" USING btree ("email_normalized") WHERE "contacts"."email_normalized" IS NOT NULL AND "contacts"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_linked_user_idx" ON "contacts" USING btree ("linked_user_id") WHERE "contacts"."linked_user_id" IS NOT NULL AND "contacts"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "contacts_owner_idx" ON "contacts" USING btree ("owner_user_id") WHERE "contacts"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_status_idx" ON "contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_display_name_idx" ON "contacts" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "contacts_follow_up_idx" ON "contacts" USING btree ("next_follow_up_at") WHERE "contacts"."next_follow_up_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_slug_idx" ON "knowledge" USING btree ("slug") WHERE "knowledge"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "knowledge_status_idx" ON "knowledge" USING btree ("status") WHERE "knowledge"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "knowledge_category_idx" ON "knowledge" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "knowledge_type_idx" ON "knowledge" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "knowledge_owner_idx" ON "knowledge" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "knowledge_review_due_idx" ON "knowledge" USING btree ("review_due_at") WHERE "knowledge"."review_due_at" IS NOT NULL AND "knowledge"."status" = 'published';--> statement-breakpoint
CREATE INDEX "knowledge_acl_knowledge_idx" ON "knowledge_access_control" USING btree ("knowledge_id");--> statement-breakpoint
CREATE INDEX "knowledge_acl_user_idx" ON "knowledge_access_control" USING btree ("grantee_user_id") WHERE "knowledge_access_control"."grantee_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "knowledge_acl_role_idx" ON "knowledge_access_control" USING btree ("grantee_role_id") WHERE "knowledge_access_control"."grantee_role_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_categories_key_idx" ON "knowledge_categories" USING btree ("key") WHERE "knowledge_categories"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "knowledge_categories_path_idx" ON "knowledge_categories" USING btree ("path");--> statement-breakpoint
CREATE INDEX "knowledge_categories_parent_idx" ON "knowledge_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_contact_links_pair_idx" ON "knowledge_contact_links" USING btree ("knowledge_id","contact_id","relation") WHERE "knowledge_contact_links"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "knowledge_contact_links_contact_idx" ON "knowledge_contact_links" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_tags_pair_idx" ON "knowledge_tags" USING btree ("knowledge_id","tag_id") WHERE "knowledge_tags"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "knowledge_tags_tag_idx" ON "knowledge_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_types_key_idx" ON "knowledge_types" USING btree ("key") WHERE "knowledge_types"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "budgets_project_period_idx" ON "budgets" USING btree ("project_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "budgets_category_idx" ON "budgets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "financial_accounts_kind_idx" ON "financial_accounts" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_categories_key_idx" ON "financial_categories" USING btree ("key") WHERE "financial_categories"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "financial_categories_kind_idx" ON "financial_categories" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "financial_categories_path_idx" ON "financial_categories" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_pair_date_idx" ON "fx_rates" USING btree ("base_code","quote_code","as_of");--> statement-breakpoint
CREATE INDEX "fx_rates_as_of_idx" ON "fx_rates" USING btree ("as_of");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("number") WHERE "invoices"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "invoices_contact_idx" ON "invoices" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "invoices_company_idx" ON "invoices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "invoices_project_idx" ON "invoices" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "invoices_overdue_idx" ON "invoices" USING btree ("due_date") WHERE "invoices"."status" IN ('sent', 'partially_paid');--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_transaction_idx" ON "payments" USING btree ("transaction_id") WHERE "payments"."transaction_id" IS NOT NULL AND "payments"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "recurring_transactions_due_idx" ON "recurring_transactions" USING btree ("next_due_on") WHERE "recurring_transactions"."is_active" = true AND "recurring_transactions"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "recurring_transactions_kind_idx" ON "recurring_transactions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "recurring_transactions_contact_idx" ON "recurring_transactions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_project_date_idx" ON "transactions" USING btree ("project_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_contact_idx" ON "transactions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "transactions_company_idx" ON "transactions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "transactions_invoice_idx" ON "transactions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "transactions_kind_date_idx" ON "transactions" USING btree ("kind","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status") WHERE "transactions"."status" <> 'reconciled';--> statement-breakpoint
CREATE UNIQUE INDEX "project_contact_links_pair_idx" ON "project_contact_links" USING btree ("project_id","contact_id","relationship") WHERE "project_contact_links"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "project_contact_links_primary_idx" ON "project_contact_links" USING btree ("project_id","relationship") WHERE "project_contact_links"."is_primary" = true AND "project_contact_links"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "project_contact_links_contact_idx" ON "project_contact_links" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_knowledge_links_pair_idx" ON "project_knowledge_links" USING btree ("project_id","knowledge_id","relation") WHERE "project_knowledge_links"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "project_knowledge_links_knowledge_idx" ON "project_knowledge_links" USING btree ("knowledge_id");--> statement-breakpoint
CREATE INDEX "project_knowledge_links_task_idx" ON "project_knowledge_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entries_project_date_idx" ON "time_entries" USING btree ("project_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entries_user_date_idx" ON "time_entries" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entries_task_idx" ON "time_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entries_unbilled_idx" ON "time_entries" USING btree ("project_id") WHERE "time_entries"."is_billable" = true AND "time_entries"."invoice_line_item_id" IS NULL AND "time_entries"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_notification_idx" ON "notification_delivery_attempts" USING btree ("notification_id","attempt_number");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_created_idx" ON "notification_delivery_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_types_key_idx" ON "notification_event_types" USING btree ("key") WHERE "notification_event_types"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "notification_event_types_category_idx" ON "notification_event_types" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_unique_idx" ON "notification_preferences" USING btree ("user_id","event_type_id","channel") WHERE "notification_preferences"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "notification_preferences_event_idx" ON "notification_preferences" USING btree ("event_type_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_suppressions_email_idx" ON "notification_suppressions" USING btree ("email","event_type_id") WHERE "notification_suppressions"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "notification_suppressions_lookup_idx" ON "notification_suppressions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_key_idx" ON "notification_templates" USING btree ("key","locale","channel") WHERE "notification_templates"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key") WHERE "notifications"."dedupe_key" IS NOT NULL AND "notifications"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "notifications_sendable_idx" ON "notifications" USING btree ("scheduled_for") WHERE "notifications"."status" IN ('pending', 'queued');--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_digest_idx" ON "notifications" USING btree ("digest_group_key") WHERE "notifications"."digest_group_key" IS NOT NULL AND "notifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;