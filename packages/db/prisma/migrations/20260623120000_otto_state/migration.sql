-- Additive: add ottoState column to ChatThread to persist serialized RunState
-- for Otto agent multi-turn conversations. Nullable — existing threads have none.
ALTER TABLE "ChatThread" ADD COLUMN "ottoState" TEXT;
