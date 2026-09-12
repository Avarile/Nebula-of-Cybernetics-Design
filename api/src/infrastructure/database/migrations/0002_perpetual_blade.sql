DROP INDEX "users_email_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique_idx" ON "users" USING btree ("email") WHERE "users"."is_deleted" = false;