-- L1 organic-publish connection capabilities (spec docs/superpowers/specs/
-- 2026-07-10-l1-meta-organic-publish-lighting.md §四B). Additive ONLY: two new boolean
-- columns on MetaConnection, both DEFAULT false. No DROP / no ALTER-that-drops / no changes
-- to any existing column. SAFE by construction on prod:
--   • canPublish            — true only when Meta actually granted instagram_content_publish
--                             + pages_manage_posts (App-Review gated). Defaults false, so every
--                             existing connection stays canPublish=false → the publish worker
--                             fail-closes and refuses to publish (zero behavior change).
--   • organicPublishPaused  — the L1 kill-switch (mirrors adsWritesPaused). Defaults false.
-- $0 path — organic publishing is free; no spend-path table is touched.

-- AddColumn
ALTER TABLE "MetaConnection" ADD COLUMN "canPublish" BOOLEAN NOT NULL DEFAULT false;

-- AddColumn
ALTER TABLE "MetaConnection" ADD COLUMN "organicPublishPaused" BOOLEAN NOT NULL DEFAULT false;
