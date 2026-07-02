/**
 * Integration tests for ReferenceImage_live_entity_asset_variant_key — the partial
 * unique index (migration 20260703000000_reference_image_live_uniqueness) that closes
 * the attachOutputs TOCTOU: findFirst-then-create lets two concurrent attachers (a
 * reaper-resumed redelivery racing a live delivery) both pass the "already attached"
 * check and create duplicate visible refs for the same paid output. The index makes
 * the second create fail P2002 at the DB; callers catch it and skip.
 *
 * Runs against a real *_test Postgres (enforced by test/setup.ts) with migrations
 * deployed, so these tests exercise the REAL index, including the COALESCE(variantId,'')
 * expression (NULLs are otherwise distinct in Postgres) and the deletedAt IS NULL partial.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./index.js";

const ORG = "ri-uniq-org";
const ENTITY = "ri-uniq-entity";
const ASSET = "ri-uniq-asset";
const VARIANT = "ri-uniq-variant";

async function seedFixtures(): Promise<void> {
  await prisma.organization.create({ data: { id: ORG } });
  await prisma.entity.create({
    data: { id: ENTITY, ownerId: ORG, type: "CHARACTER", name: "uniq test entity" },
  });
  await prisma.asset.create({
    data: {
      id: ASSET,
      ownerId: ORG,
      contentHash: "cafe".repeat(16),
      ext: "png",
      mime: "image/png",
      sizeBytes: BigInt(1),
      source: "GENERATED",
    },
  });
  await prisma.entityVariant.create({
    data: { id: VARIANT, ownerId: ORG, entityId: ENTITY, name: "v", handle: "v" },
  });
}

function createRef(id: string, variantId: string | null, deletedAt: Date | null = null) {
  return prisma.referenceImage.create({
    data: { id, ownerId: ORG, entityId: ENTITY, assetId: ASSET, variantId, position: 0, deletedAt },
  });
}

beforeEach(async () => {
  await seedFixtures();
});

describe("ReferenceImage live-uniqueness index", () => {
  it("rejects a second LIVE attach of the same (entity, asset, null variant) with P2002", async () => {
    await createRef("ri1", null);
    // COALESCE(variantId,'') is load-bearing here: bare NULLs are distinct in
    // Postgres, so without it two null-variant dups would both insert.
    await expect(createRef("ri2", null)).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a second LIVE attach of the same (entity, asset, variant) with P2002", async () => {
    await createRef("ri1", VARIANT);
    await expect(createRef("ri2", VARIANT)).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows the same asset as both a base ref and a variant ref", async () => {
    await createRef("ri1", null);
    await expect(createRef("ri2", VARIANT)).resolves.toMatchObject({ id: "ri2" });
  });

  it("does NOT block re-attaching after the previous ref was soft-deleted (partial index)", async () => {
    await createRef("ri1", null, new Date());
    await expect(createRef("ri2", null)).resolves.toMatchObject({ id: "ri2" });
  });
});
