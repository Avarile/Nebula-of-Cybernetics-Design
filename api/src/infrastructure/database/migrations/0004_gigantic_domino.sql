ALTER TABLE "imap_configs" ALTER COLUMN "secret_enc" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "integration_credentials" ALTER COLUMN "secret_enc" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "smtp_configs" ALTER COLUMN "secret_enc" SET DATA TYPE text;