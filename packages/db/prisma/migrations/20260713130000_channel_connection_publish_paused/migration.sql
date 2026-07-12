-- B4 · E4-14 (X adapter): per-channel organic-publish kill-switch on ChannelConnection
-- (freeze rider R5; the analogue of MetaConnection.organicPublishPaused). The X publish gate
-- fail-closes (refuses, zero external calls) when publishPaused = true.
-- ADDITIVE ONLY — one new column with a safe default; no data-loss DDL (destructive gate green).
-- Rollback: drop the column (nothing references it structurally).
-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN "publishPaused" BOOLEAN NOT NULL DEFAULT false;
