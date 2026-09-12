CREATE TYPE "public"."credential_kind" AS ENUM('api_key', 'oauth2', 'basic', 'bearer');--> statement-breakpoint
CREATE TYPE "public"."setting_type" AS ENUM('string', 'number', 'boolean', 'json');--> statement-breakpoint
CREATE TABLE "imap_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"username" varchar(255),
	"secret_enc" varchar(2048),
	"secure" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_status" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" "credential_kind" DEFAULT 'api_key' NOT NULL,
	"secret_enc" varchar(2048) NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_tested_at" timestamp with time zone,
	"last_test_status" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "smtp_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"username" varchar(255),
	"secret_enc" varchar(2048),
	"secure" boolean DEFAULT true NOT NULL,
	"from_address" varchar(255) NOT NULL,
	"from_name" varchar(255),
	"is_active" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_status" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "system_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" varchar(45),
	"user_agent" varchar(512)
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" varchar(150) NOT NULL,
	"value_json" jsonb NOT NULL,
	"type" "setting_type" NOT NULL,
	"category" varchar(100) DEFAULT 'general' NOT NULL,
	"description" varchar(500)
);
--> statement-breakpoint
ALTER TABLE "system_audit_log" ADD CONSTRAINT "system_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imap_configs_single_active_idx" ON "imap_configs" USING btree ("is_active") WHERE "imap_configs"."is_active" = true AND "imap_configs"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_provider_name_idx" ON "integration_credentials" USING btree ("provider","name") WHERE "integration_credentials"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "integration_credentials_provider_idx" ON "integration_credentials" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "smtp_configs_single_active_idx" ON "smtp_configs" USING btree ("is_active") WHERE "smtp_configs"."is_active" = true AND "smtp_configs"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "system_audit_entity_idx" ON "system_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "system_audit_actor_idx" ON "system_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "system_audit_created_idx" ON "system_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_key_idx" ON "system_settings" USING btree ("key") WHERE "system_settings"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "system_settings_category_idx" ON "system_settings" USING btree ("category");