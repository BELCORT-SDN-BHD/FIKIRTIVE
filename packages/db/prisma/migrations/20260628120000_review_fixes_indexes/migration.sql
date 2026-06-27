-- F5: dedup BrandKit per owner+brand, including the common brandId IS NULL case
-- (plain UNIQUE(ownerId, brandId) would NOT dedup NULL brandId — NULLs are distinct in Postgres).
CREATE UNIQUE INDEX "BrandKit_owner_brand_unique" ON "BrandKit"("ownerId", COALESCE("brandId", ''));

-- F6: drop the unused favorite index (the favorites library query is served by Generation_library_idx).
DROP INDEX IF EXISTS "Generation_ownerId_favorite_deletedAt_idx";
