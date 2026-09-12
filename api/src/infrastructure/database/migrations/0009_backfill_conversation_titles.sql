-- Backfill agent_conversation.title for conversations created before titles
-- were surfaced. Mastra generates a title onto its own `mastra.mastra_threads`
-- row; without this, every pre-existing thread renders as "Untitled
-- conversation" in the chat history rail.
--
-- Guarded on the table existing: the `mastra.*` schema is created lazily by
-- @mastra/pg at application boot, so on a fresh database this migration runs
-- first and there is simply nothing to backfill.
--
-- Whitespace is collapsed and the result capped at 80 chars to match
-- `sanitizeTitle` in features/mastra/services/conversation-title.ts — Mastra
-- sometimes stores an entire model reply in that column.
DO $$ BEGIN
  IF to_regclass('mastra.mastra_threads') IS NOT NULL THEN
    UPDATE agent_conversation ac
       SET title = left(btrim(regexp_replace(mt.title, '\s+', ' ', 'g')), 80)
      FROM mastra.mastra_threads mt
     WHERE mt.id = ac.id::text
       AND ac.title IS NULL
       AND btrim(mt.title) <> '';
  END IF;
END $$;
