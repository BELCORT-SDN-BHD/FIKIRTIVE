-- B0-103: cold-start posting-time seed table + its static seed rows (GRILL-VERDICTS:157).
-- ADDITIVE ONLY — one new table + indexes + INSERTs; no data-loss DDL (destructive gate green).
-- The seed is illustrative craft knowledge (best windows to post, in UTC), the same for every owner;
-- the composer/Otto suggest from it before a user has history of their own.
-- Rollback: drop the "PostingTimeSeed" table (nothing references it).

-- CreateTable
CREATE TABLE "PostingTimeSeed" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hourUtc" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PostingTimeSeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingTimeSeed_channel_idx" ON "PostingTimeSeed"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "PostingTimeSeed_channel_dayOfWeek_hourUtc_key" ON "PostingTimeSeed"("channel", "dayOfWeek", "hourUtc");

-- Seed rows (static, global, idempotent-safe). dayOfWeek: 0=Sunday … 6=Saturday. hourUtc: 0–23.
INSERT INTO "PostingTimeSeed" ("id", "channel", "dayOfWeek", "hourUtc", "score", "rationale") VALUES
  ('pts_ig_1_12', 'instagram', 1, 12, 70, 'weekday lunch-break scroll'),
  ('pts_ig_3_11', 'instagram', 3, 11, 85, 'midweek late-morning peak'),
  ('pts_ig_3_19', 'instagram', 3, 19, 90, 'midweek evening scroll peak'),
  ('pts_ig_5_10', 'instagram', 5, 10, 80, 'friday morning momentum'),
  ('pts_ig_6_11', 'instagram', 6, 11, 75, 'weekend late-morning leisure'),
  ('pts_ig_0_19', 'instagram', 0, 19, 78, 'sunday evening wind-down'),
  ('pts_fb_1_13', 'facebook', 1, 13, 65, 'weekday early-afternoon'),
  ('pts_fb_3_13', 'facebook', 3, 13, 80, 'midweek early-afternoon peak'),
  ('pts_fb_4_14', 'facebook', 4, 14, 82, 'thursday afternoon engagement'),
  ('pts_fb_5_13', 'facebook', 5, 13, 78, 'friday afternoon'),
  ('pts_fb_0_12', 'facebook', 0, 12, 70, 'sunday midday')
ON CONFLICT ("channel", "dayOfWeek", "hourUtc") DO NOTHING;
