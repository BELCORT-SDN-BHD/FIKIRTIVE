-- Rename EntityType enum value BRAND -> BRANDMARK (ADR docs/adr/0001-brand-vocabulary.md).
-- Postgres in-place value rename: existing rows migrate automatically; no drop/recreate.
ALTER TYPE "EntityType" RENAME VALUE 'BRAND' TO 'BRANDMARK';
