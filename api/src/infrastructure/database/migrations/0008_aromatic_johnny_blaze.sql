CREATE TABLE "email_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"email_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"filename" varchar(512),
	"content_type" varchar(255) NOT NULL,
	"size" integer NOT NULL,
	"content_id" varchar(255),
	"inline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"account_id" uuid NOT NULL,
	"mailbox" varchar(255) DEFAULT 'INBOX' NOT NULL,
	"uid" integer NOT NULL,
	"uid_validity" bigint NOT NULL,
	"message_id" varchar(998),
	"in_reply_to" varchar(998),
	"references" text,
	"thread_id" varchar(998),
	"from_address" varchar(320) DEFAULT '' NOT NULL,
	"from_name" varchar(255),
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"snippet" varchar(280) DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"body_html" text,
	"size_bytes" integer,
	"seen" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"raw_file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "email_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"account_id" uuid NOT NULL,
	"mailbox" varchar(255) DEFAULT 'INBOX' NOT NULL,
	"uid_validity" bigint,
	"last_seen_uid" integer DEFAULT 0 NOT NULL,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_finished_at" timestamp with time zone,
	"last_status" varchar(50),
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "email_attachments_email_idx" ON "email_attachments" USING btree ("email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_identity_idx" ON "email_messages" USING btree ("account_id","mailbox","uid_validity","uid") WHERE "email_messages"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "email_messages_list_idx" ON "email_messages" USING btree ("account_id","mailbox","received_at");--> statement-breakpoint
CREATE INDEX "email_messages_message_id_idx" ON "email_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_messages_thread_idx" ON "email_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_messages_seen_idx" ON "email_messages" USING btree ("account_id","seen");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sync_state_account_mailbox_idx" ON "email_sync_state" USING btree ("account_id","mailbox") WHERE "email_sync_state"."is_deleted" = false;