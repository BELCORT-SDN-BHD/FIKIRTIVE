/** Security integration tests for the tenant boundary.
 *
 * Two real organizations exercise the Prisma guard, database tenant foreign keys, and
 * user-facing server actions. Every unsafe write must be rejected and leave victim data intact.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Post NextAuth retirement: requireOwner reads the session via @/lib/better-auth/compat
// (auth()) and the allowlist via @/lib/allowlist. Mock both — auth() controllable per-test;
// allowed()/isFounderAdmin() env-driven (inlined, no DB). Same pattern as isolation.test.ts.
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
// Unlike isolation.test.ts (reads only) this suite drives WRITE server actions, and every
// one of them calls revalidatePath — which has no Next.js request context under vitest.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const A_EMAIL = `wOrgA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `wOrgB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test"; // neither A nor B is founder
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const actions = await import("@/lib/actions");
const { storageKey, storageKeyToSrc } = await import("@fikirtive/core");

async function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA: string, orgB: string;
// org A — the victim
let aProjectId: string, aEntityId: string, aEntityVariantId: string;
let aAssetId: string, aAssetHash: string, aCampaignId: string;
let aGenerationId: string;           // read-only witness: A's own generation, never attached
let aShotId: string;                 // read-only witness: nothing in this file may mutate it
let aShotForUncheckedUpdate: string;
let aShotForUncheckedDelete: string;
let aSrc: string;                    // A's content-addressed src (/files/u/<orgA>/<hash>.png)
// The cached transcript's key is GLOBAL (@@unique([contentHash, model]) — no ownerId), so
// A's content hash is randomised per run: a fixed hash would collide with a leftover row
// from an earlier run (or another test file) and break seeding.
const A_TRANSCRIPT_CUES = [{ startMs: 0, lengthMs: 1000, text: "A's private transcript" }];
// org B — the attacker
let bProjectId: string, bShotId: string, bGenerationId: string, bAssetId: string, bEntityId: string;
let bSrcForAContent: string;         // B's OWN namespace, A's content hash — a forged src

let shotSeq = 900_000;
async function seedShot(ownerId: string, projectId: string, title: string): Promise<string> {
  const id = `sht_${randomUUID()}`;
  await prisma.shot.create({ data: { id, ownerId, projectId, number: shotSeq++, title } });
  return id;
}

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  // ── org A's data (the target). Seeded directly for speed; every ASSERTION goes
  //    through the real guard / the real action, exactly as isolation.test.ts does.
  aProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: aProjectId, ownerId: orgA, name: "A campaign" } });
  aAssetHash = randomUUID().replace(/-/g, "").repeat(2); // 64 hex chars — storageKey requires it
  aSrc = storageKeyToSrc(storageKey(orgA, aAssetHash, "png"));
  bSrcForAContent = storageKeyToSrc(storageKey(orgB, aAssetHash, "png"));
  const aAsset = await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: aAssetHash, ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
  aAssetId = aAsset.id;
  // A LIVE org-A generation, unattached (shotId null) — so attachGeneration's own
  // generation lookup is exercised with a REAL cross-tenant id, not a nonexistent one.
  const aGen = await prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgA, projectId: aProjectId, assetId: aAsset.id, source: "GENERATED", entitySnapshot: {} } });
  aGenerationId = aGen.id;
  const aEntity = await prisma.entity.create({ data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: "A's secret brand character", type: "CHARACTER" } });
  aEntityId = aEntity.id;
  const aVariant = await prisma.entityVariant.create({ data: { id: `var_${randomUUID()}`, ownerId: orgA, entityId: aEntityId, name: "A variant", handle: `a-${randomUUID()}` } });
  aEntityVariantId = aVariant.id;
  const aCampaign = await prisma.campaign.create({
    data: {
      id: `cmp_${randomUUID()}`,
      ownerId: orgA,
      name: "A campaign group",
      goal: "Tenant FK test",
      startAt: new Date("2026-01-01T00:00:00.000Z"),
      endAt: new Date("2026-01-02T00:00:00.000Z"),
      planJson: {},
    },
  });
  aCampaignId = aCampaign.id;
  aShotId = await seedShot(orgA, aProjectId, "A untouched");
  aShotForUncheckedUpdate = await seedShot(orgA, aProjectId, "A unchecked-update target");
  aShotForUncheckedDelete = await seedShot(orgA, aProjectId, "A unchecked-delete target");
  // the cached transcript for A's content, in the REAL CaptionCue shape (startMs/lengthMs/
  // text) — the wrong shape would fail getTranscript's zod parse and silently return [].
  await prisma.transcript.create({
    data: { id: `trs_${randomUUID()}`, ownerId: orgA, contentHash: aAssetHash, model: "base.en", cuesJson: A_TRANSCRIPT_CUES },
  });

  // ── org B's own data (the attacker needs legitimate rows to attack FROM)
  bProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: bProjectId, ownerId: orgB, name: "B campaign" } });
  bShotId = await seedShot(orgB, bProjectId, "B shot");
  const bAsset = await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgB, contentHash: "b".repeat(64), ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
  bAssetId = bAsset.id;
  const bEntity = await prisma.entity.create({ data: { id: `ent_${randomUUID()}`, ownerId: orgB, name: "B entity", type: "CHARACTER" } });
  bEntityId = bEntity.id;
  const bGen = await prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgB, projectId: bProjectId, assetId: bAsset.id, source: "GENERATED", entitySnapshot: {} } });
  bGenerationId = bGen.id;
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — the guard is armed (control)", () => {
  // If any of these fails, the whole file is meaningless: it means the guard is not in
  // strict mode, or the harness never reached the database.
  it("Shot.updateMany with no ownerId THROWS, and org A's row is untouched", async () => {
    await expect(
      prisma.shot.updateMany({ where: { id: aShotId }, data: { title: "pwned by B" } }),
    ).rejects.toThrow(/tenant-guard/);
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotId }, select: { title: true } });
    expect(after?.title).toBe("A untouched");
  });

  it("Shot.deleteMany with no ownerId THROWS, and org A's row still exists", async () => {
    await expect(
      prisma.shot.deleteMany({ where: { id: aShotId } }),
    ).rejects.toThrow(/tenant-guard/);
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotId }, select: { id: true } });
    expect(after).not.toBeNull();
  });

  // A SECOND model, deliberately. The guard's coverage is a hand-maintained registry
  // (TENANT_MODELS in packages/db/src/tenant-guard.ts): a model can silently fall out of
  // that Set and every Shot-only control stays green. Project is the highest-value second
  // witness — it is the root of the creative-core graph and the target of deleteProject.
  it("Project.updateMany with no ownerId THROWS (TENANT_MODELS still covers Project)", async () => {
    await expect(
      prisma.project.updateMany({ where: { id: aProjectId }, data: { name: "pwned by B" } }),
    ).rejects.toThrow(/tenant-guard/);
    const after = await prisma.project.findFirst({ where: { ownerId: orgA, id: aProjectId }, select: { name: true } });
    expect(after?.name).toBe("A campaign");
  });

  it("Project.deleteMany with no ownerId THROWS, and org A's campaign still exists", async () => {
    await expect(
      prisma.project.deleteMany({ where: { id: aProjectId } }),
    ).rejects.toThrow(/tenant-guard/);
    const after = await prisma.project.findFirst({ where: { ownerId: orgA, id: aProjectId }, select: { id: true } });
    expect(after).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — unique writes require an owner scope", () => {
  it("Shot.update without ownerId is rejected and leaves the row intact", async () => {
    await expect(
      prisma.shot.update({ where: { id: aShotForUncheckedUpdate }, data: { title: "pwned by B via update" } }),
    ).rejects.toThrow(/tenant-guard/);
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForUncheckedUpdate }, select: { title: true } });
    expect(after?.title).toBe("A unchecked-update target");
  });

  it("Shot.delete without ownerId is rejected and leaves the row intact", async () => {
    await expect(
      prisma.shot.delete({ where: { id: aShotForUncheckedDelete } }),
    ).rejects.toThrow(/tenant-guard/);
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForUncheckedDelete }, select: { id: true } });
    expect(after?.id).toBe(aShotForUncheckedDelete);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("Transcript — a GLOBAL content-addressed cache, gated at the READ path", () => {
  // Transcript is an explicit tenant-guard exemption: identical bytes produce identical cues.
  // Access is granted only after the caller proves it owns an asset with that content hash.

  it("[design] org A reads its own cached transcript (control — the cache is reachable)", async () => {
    await asUser(A_EMAIL);
    expect(await actions.getTranscript(aProjectId, aSrc)).toEqual(A_TRANSCRIPT_CUES);
  });

  it("[security] org B cannot read A's cached transcript with A's src", async () => {
    await asUser(B_EMAIL);
    // keyOwnerMatches() rejects the foreign namespace inside ownedAssetFromSrc (actions.ts:1026)
    expect(await actions.getTranscript(bProjectId, aSrc)).toEqual([]);
    // and A's project id doesn't help either — the project gate is owner-scoped too
    expect(await actions.getTranscript(aProjectId, aSrc)).toEqual([]);
  });

  it("[security] org B cannot read it by forging its OWN src for A's content hash", async () => {
    // The src now passes keyOwnerMatches (it is B's namespace), so the ONLY thing standing
    // between B and A's cached cues is "do you own an asset with this contentHash?".
    await asUser(B_EMAIL);
    expect(await actions.getTranscript(bProjectId, bSrcForAContent)).toEqual([]);
  });

  it("[design] once org B actually possesses the same bytes, it shares the cache row", async () => {
    // This is the design working as intended, not a leak: B now holds an asset with the same
    // contentHash, so whisper would produce these exact cues for B anyway. Sharing the row is
    // the $0 + 0 CPU cache hit the schema comment describes.
    await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgB, contentHash: aAssetHash, ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
    await asUser(B_EMAIL);
    expect(await actions.getTranscript(bProjectId, bSrcForAContent)).toEqual(A_TRANSCRIPT_CUES);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — boundaries outside the Prisma guard", () => {
  it("a nested update stays within its owner-scoped parent relation", async () => {
    await expect(
      prisma.project.update({
        where: { id: bProjectId, ownerId: orgB },
        data: { shots: { updateMany: { where: {}, data: { description: "nested write" } } } },
      }),
    ).resolves.toBeDefined();
    const aWitness = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotId }, select: { description: true } });
    expect(aWitness?.description).toBe(""); // org A unaffected — blind spot, not a leak
  });

  it("addEntityAlias refuses a foreign entity before its raw SQL write", async () => {
    await asUser(B_EMAIL);
    const res = await actions.addEntityAlias(aEntityId, "pwned");
    expect(res).toEqual({ error: "Entity not found." });
    const entity = await prisma.entity.findFirst({ where: { ownerId: orgA, id: aEntityId }, select: { aliases: true } });
    expect(entity?.aliases).toEqual([]);
  });

  it("the raw-SQL ownerId predicate rejects a foreign tenant and accepts the owner", async () => {
    const refused = await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_append("aliases", ${"pwned"}) WHERE "id" = ${aEntityId} AND "ownerId" = ${orgB} AND "deletedAt" IS NULL AND NOT (${"pwned"} = ANY("aliases"))`;
    expect(refused).toBe(0);
    const untouched = await prisma.entity.findFirst({ where: { ownerId: orgA, id: aEntityId }, select: { aliases: true } });
    expect(untouched?.aliases).toEqual([]);

    const landed = await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_append("aliases", ${"pwned"}) WHERE "id" = ${aEntityId} AND "ownerId" = ${orgA} AND "deletedAt" IS NULL AND NOT (${"pwned"} = ANY("aliases"))`;
    expect(landed).toBe(1);
    const mutated = await prisma.entity.findFirst({ where: { ownerId: orgA, id: aEntityId }, select: { aliases: true } });
    expect(mutated?.aliases).toEqual(["pwned"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — creative-core relations are tenant-bound in Postgres", () => {
  it("EntityVariant cannot reference another tenant's Entity", async () => {
    await expect(
      prisma.entityVariant.create({
        data: { id: `var_${randomUUID()}`, ownerId: orgB, entityId: aEntityId, name: "foreign", handle: `foreign-${randomUUID()}` },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("ReferenceImage cannot reference another tenant's Entity", async () => {
    await expect(
      prisma.referenceImage.create({ data: { id: `ref_${randomUUID()}`, ownerId: orgB, entityId: aEntityId, assetId: bAssetId } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("ReferenceImage cannot reference another tenant's Asset", async () => {
    await expect(
      prisma.referenceImage.create({ data: { id: `ref_${randomUUID()}`, ownerId: orgB, entityId: bEntityId, assetId: aAssetId } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("ReferenceImage cannot reference another tenant's EntityVariant", async () => {
    await expect(
      prisma.referenceImage.create({
        data: { id: `ref_${randomUUID()}`, ownerId: orgB, entityId: bEntityId, assetId: bAssetId, variantId: aEntityVariantId },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("Shot cannot reference another tenant's Project", async () => {
    await expect(
      prisma.shot.create({ data: { id: `sht_${randomUUID()}`, ownerId: orgB, projectId: aProjectId, number: shotSeq++, title: "foreign" } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("ShotEntityRef cannot reference another tenant's Shot", async () => {
    await expect(
      prisma.shotEntityRef.create({ data: { shotId: aShotId, entityId: bEntityId, ownerId: orgB } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("ShotEntityRef cannot reference another tenant's Entity", async () => {
    await expect(
      prisma.shotEntityRef.create({ data: { shotId: bShotId, entityId: aEntityId, ownerId: orgB } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("Generation cannot reference another tenant's Project", async () => {
    await expect(
      prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgB, projectId: aProjectId, assetId: bAssetId, source: "GENERATED", entitySnapshot: {} } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("Generation cannot reference another tenant's Shot", async () => {
    await expect(
      prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgB, projectId: bProjectId, assetId: bAssetId, shotId: aShotId, source: "GENERATED", entitySnapshot: {} } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("Generation cannot reference another tenant's Asset", async () => {
    await expect(
      prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgB, projectId: bProjectId, assetId: aAssetId, source: "GENERATED", entitySnapshot: {} } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("Generation cannot reference another tenant's Campaign", async () => {
    await expect(
      prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgB, projectId: bProjectId, assetId: bAssetId, campaignId: aCampaignId, source: "GENERATED", entitySnapshot: {} } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — the real product surface (what a merchant can actually drive)", () => {
  // These are the highest-risk browser-driven writes with attacker-controlled identifiers.

  it("deleteProject: B cannot delete A's campaign", async () => {
    await asUser(B_EMAIL);
    expect(await actions.deleteProject(aProjectId)).toEqual({ error: "Project not found." });
    const still = await prisma.project.findFirst({ where: { ownerId: orgA, id: aProjectId }, select: { id: true } });
    expect(still).not.toBeNull();
    const shotsLeft = await prisma.shot.findMany({ where: { ownerId: orgA, projectId: aProjectId }, select: { id: true } });
    expect(shotsLeft.length).toBeGreaterThan(0);
  });

  it("renameProject: B cannot rename A's campaign", async () => {
    await asUser(B_EMAIL);
    expect(await actions.renameProject(aProjectId, "pwned by B")).toEqual({ error: "Project not found." });
    const after = await prisma.project.findFirst({ where: { ownerId: orgA, id: aProjectId }, select: { name: true } });
    expect(after?.name).toBe("A campaign");
  });

  it("createShot: B cannot create a shot inside A's campaign", async () => {
    await asUser(B_EMAIL);
    const before = await prisma.shot.count({ where: { ownerId: orgB, projectId: aProjectId } });
    expect(await actions.createShot(aProjectId)).toEqual({ error: "Project not found." });
    const after = await prisma.shot.count({ where: { ownerId: orgB, projectId: aProjectId } });
    expect(after).toBe(before);
  });

  it("saveShotPrompt: B cannot write A's shot", async () => {
    await asUser(B_EMAIL);
    const res = await actions.saveShotPrompt(aShotId, JSON.stringify({ type: "doc" }), "pwned by B", []);
    expect(res).toEqual({ error: "Shot not found." });
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotId }, select: { description: true } });
    expect(after?.description).toBe("");
  });

  it("saveShotPrompt IDOR guard: B cannot link A's entity into B's OWN shot", async () => {
    await asUser(B_EMAIL);
    const res = await actions.saveShotPrompt(bShotId, JSON.stringify({ type: "doc" }), "hi", [aEntityId]);
    expect(res).toEqual({ error: "One or more referenced entities were not found." });
    const refs = await prisma.shotEntityRef.findMany({ where: { ownerId: orgB, shotId: bShotId } });
    expect(refs).toEqual([]);
  });

  it("attachGeneration: B cannot attach across the tenant boundary in either direction", async () => {
    await asUser(B_EMAIL);
    // direction 1 — B's own generation → A's shot (exercises the SHOT-side ownerId filter)
    expect(await actions.attachGeneration(bGenerationId, aShotId)).toEqual({ error: "Shot not found." });
    // direction 2 — org A's REAL, live, unattached generation → B's own shot. A real id is
    // what exercises the GENERATION-side ownerId filter (actions.ts:748); a nonexistent id
    // would be refused whether or not that lookup carried ownerId at all.
    expect(await actions.attachGeneration(aGenerationId, bShotId)).toEqual({ error: "Generation not found." });
    // …and a forged id still fails closed
    expect(await actions.attachGeneration(`gen_${randomUUID()}`, bShotId)).toEqual({ error: "Generation not found." });
    const aShot = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotId }, select: { status: true } });
    expect(aShot?.status).toBe("DRAFT"); // never flipped to ATTACHED
    const aGen = await prisma.generation.findFirst({ where: { ownerId: orgA, id: aGenerationId }, select: { shotId: true, attachedAt: true } });
    expect(aGen?.shotId).toBeNull();     // org A's generation was never linked to B's shot
    expect(aGen?.attachedAt).toBeNull();
    const bShot = await prisma.shot.findFirst({ where: { ownerId: orgB, id: bShotId }, select: { status: true } });
    expect(bShot?.status).toBe("DRAFT"); // B's own shot never flipped either
    const bGen = await prisma.generation.findFirst({ where: { ownerId: orgB, id: bGenerationId }, select: { shotId: true } });
    expect(bGen?.shotId).toBeNull();
  });
});

afterAll(async () => {
  const both = [orgA, orgB];
  const purge = async (step: (id: string) => Promise<unknown>) => {
    for (const id of both) {
      try { await step(id); } catch { /* best-effort cleanup — never fail the suite here */ }
    }
  };
  // business rows, child → parent
  await purge((ownerId) => prisma.shotEntityRef.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.generation.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.shot.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.transcript.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.referenceImage.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.entityVariant.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.entity.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.asset.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.project.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.campaign.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.actionEvent.deleteMany({ where: { ownerId } }));
  // IDENTITY rows requireOwner bootstrapped for this run (auth-guard.ts:88 — Organization +
  // Membership + CreditAccount + the beta CreditLedger grant). Scoped to THIS run's two
  // random identities only; nothing outside them is ever touched. Credits → membership →
  // org → user, so no FK blocks the next step.
  await purge((orgId) => prisma.creditLedger.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.creditAccount.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.membership.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.organization.deleteMany({ where: { id: orgId } }));
  // User cascades to Account/Session/Membership (schema.prisma:564, 573, 688)
  try {
    await prisma.user.deleteMany({ where: { email: { in: [A_EMAIL, B_EMAIL] } } });
  } catch { /* best-effort cleanup */ }
});
