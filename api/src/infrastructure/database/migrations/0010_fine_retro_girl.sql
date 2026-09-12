ALTER TABLE "search_records" ADD COLUMN "index_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "search_records" ADD COLUMN "index_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "search_records_unsynced_idx" ON "search_records" USING btree ("index_attempted_at") WHERE "search_records"."index_state" <> 'INDEXED';--> statement-breakpoint
CREATE INDEX "search_records_purgeable_idx" ON "search_records" USING btree ("deleted_at") WHERE "search_records"."is_deleted" = true AND "search_records"."index_state" = 'INDEXED';--> statement-breakpoint
-- Backfill `index_attempted_at` so pre-existing rows are visible to the
-- reconciliation sweep. Its predicate is `index_attempted_at < cutoff`, which is
-- never true for NULL, so without this every record written before this
-- migration would be permanently invisible to drift repair.
--  - unconverged rows inherit `updated_at` (the last handoff we can prove),
--    which makes them immediately eligible and correctly ordered oldest-first;
--  - converged rows inherit `indexed_at` purely for a truthful history.
UPDATE "search_records"
   SET "index_attempted_at" = "updated_at"
 WHERE "index_attempted_at" IS NULL
   AND "index_state" <> 'INDEXED';--> statement-breakpoint
UPDATE "search_records"
   SET "index_attempted_at" = "indexed_at"
 WHERE "index_attempted_at" IS NULL
   AND "index_state" = 'INDEXED'
   AND "indexed_at" IS NOT NULL;
