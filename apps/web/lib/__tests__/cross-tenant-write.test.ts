/**
 * Cross-tenant WRITE red-team suite — the write-side twin of isolation.test.ts.
 *
 * WHAT THIS PROVES (green, always executed):
 *  - The tenant guard is ARMED under NODE_ENV=test: `updateMany`/`deleteMany` on a
 *    TENANT_MODELS model with no ownerId filter THROWS, and org A's row is untouched.
 *  - The product surface is fail-closed: org B calling the real exported server actions
 *    (deleteProject / saveShotPrompt / attachGeneration) with org A's ids gets a
 *    "not found" refusal and writes nothing. That is the actual attack path a merchant
 *    can drive from a browser, so it is tested through the real requireOwner() path.
 *  - saveShotPrompt's IDOR guard stops the cross-tenant FOREIGN KEY shape at the product
 *    layer: org B cannot link org A's Entity into org B's own Shot.
 *
 * WHAT THIS DOES NOT PROVE (deliberately pinned as executable characterizations):
 *  - The guard is a PRESENCE check, not an IDENTITY check. It has no authenticated
 *    principal to compare against, so a forged `ownerId: <org A>` passes it. Only
 *    requireOwner()-derived ownerId at the call site provides identity. #320 does NOT
 *    close this family.
 *  - `update` / `upsert` / `delete` by unique key are not checked at all (#320).
 *  - Nested writes and raw SQL are outside a Prisma client extension by construction.
 *  - The creative-core object graph (Shot / Entity / ShotEntityRef / Generation) has NO
 *    same-tenant composite foreign keys — those tables don't even carry the
 *    `@@unique([id, ownerId])` such an FK requires — so org B can point an FK at an
 *    org-A row and then read that row back through its OWN owner-scoped query (#317).
 *    NOTE: the pattern is NOT absent from the database — the newer CRM/consent tables
 *    (Contact, ChannelScope, ChannelConnection, Membership, …) already ship
 *    `@@unique([id, ownerId])` + `FOREIGN KEY (x, ownerId) REFERENCES y(id, ownerId)`.
 *    #317 is about extending that existing pattern backwards, not inventing it.
 *
 * OPEN GAPS AND THEIR OWNING ISSUES:
 *  - #320 — tenant-guard vacuum: `update` / `upsert` / `delete` are not in CHECKED_OPS,
 *    and whereHasOwnerId() does not look inside compound-unique wrappers.
 *  - #459 — the guard is presence-only: a forged `ownerId` satisfies whereHasOwnerId(),
 *    so the forged-ownerId family stays open even after #320 lands.
 *  - #317 — the creative-core tables still have no same-tenant composite foreign keys.
 *
 * HOW THE EXPECTED-FAIL MARKERS WORK (read before editing):
 *  Cases that assert behaviour the codebase does NOT have yet are marked `it.fails`.
 *  Vitest inverts the result: the body fails today → the case reports PASS, so CI stays
 *  honestly green while the gap lives in executable code instead of prose. The moment
 *  #320 / #317 land, the body starts passing and vitest reports "Expect test to fail"
 *  → the suite goes RED. The fix therefore cannot land silently; removing the `.fails`
 *  marker is the acceptance evidence for the owning issue.
 *  CAVEAT: `.fails` is a WEAK oracle on its own — `rejects.toThrow()` fails identically
 *  whether the promise RESOLVED or rejected for an unrelated reason. So every `.fails`
 *  case keeps its body to a single assertion AND is paired with a plain-green
 *  `[… impact]` case that performs the same write on its OWN throwaway row and READS
 *  BACK the result. The green half is the real oracle (it proves the write lands today);
 *  the `.fails` half is the tripwire (it goes red when the gap closes). All seeding stays
 *  in beforeAll.
 *  ALSO: those green halves are coupled to their gaps by construction. Once #320 lands,
 *  `[#320 impact] Shot.update`, `[#320 impact] Shot.delete` and `[#320 impact] Transcript
 *  upsert TAKES OVER` all start throwing, and `[scope note] forged compound unique key`
 *  stays green only if the fix descends into compound-unique wrappers. Once #317 lands,
 *  `[#317 impact]` goes red too — its shotEntityRef.create becomes a constraint violation.
 *  Expect both PRs to revisit this file in more places than just removing `.fails` markers.
 *
 * Harness: same as isolation.test.ts — two real organisations bootstrapped through the
 * real requireOwner() against the local *_test Postgres (see apps/web/vitest.config.ts
 * + lib/__tests__/setup-db-guard.ts). No principal is fabricated.
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
const data = await import("@/lib/data");
const actions = await import("@/lib/actions");

async function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA: string, orgB: string;
// org A — the victim
let aProjectId: string, aEntityId: string, aAssetHash: string;
let aGenerationId: string;           // read-only witness: A's own generation, never attached
let aShotId: string;                 // read-only witness: nothing in this file may mutate it
let aShotForForgedUpdate: string;    // throwaway — the forged-ownerId updateMany clobbers it
let aShotForForgedDelete: string;    // throwaway — the forged-ownerId deleteMany removes it
let aShotForUncheckedUpdate: string; // throwaway — the #320 `update` it.fails case clobbers it
let aShotForUncheckedDelete: string; // throwaway — the #320 `delete` it.fails case removes it
let aShotForUpdateImpact: string;    // throwaway — the #320 `update` GREEN read-back clobbers it
let aShotForDeleteImpact: string;    // throwaway — the #320 `delete` GREEN read-back removes it
let aShotForRawSql: string;          // throwaway — the $executeRaw case clobbers it
// Transcript's unique key is GLOBAL (@@unique([contentHash, model]) — no ownerId), so these
// must be unique per run or they would collide with another test file's transcript rows.
const A_TRANSCRIPT_HASH = randomUUID().replace(/-/g, "").repeat(2);   // characterization: B's upsert clobbers it
const A_TRANSCRIPT_HASH_2 = randomUUID().replace(/-/g, "").repeat(2); // #320 it.fails case
// org B — the attacker
let bProjectId: string, bShotId: string, bShotId2: string, bGenerationId: string;

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
  aAssetHash = "a".repeat(64);
  const aAsset = await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: aAssetHash, ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
  // A LIVE org-A generation, unattached (shotId null) — so attachGeneration's own
  // generation lookup is exercised with a REAL cross-tenant id, not a nonexistent one.
  const aGen = await prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgA, projectId: aProjectId, assetId: aAsset.id, source: "GENERATED", entitySnapshot: {} } });
  aGenerationId = aGen.id;
  const aEntity = await prisma.entity.create({ data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: "A's secret brand character", type: "CHARACTER" } });
  aEntityId = aEntity.id;
  aShotId = await seedShot(orgA, aProjectId, "A untouched");
  aShotForForgedUpdate = await seedShot(orgA, aProjectId, "A forged-update target");
  aShotForForgedDelete = await seedShot(orgA, aProjectId, "A forged-delete target");
  aShotForUncheckedUpdate = await seedShot(orgA, aProjectId, "A unchecked-update target");
  aShotForUncheckedDelete = await seedShot(orgA, aProjectId, "A unchecked-delete target");
  aShotForUpdateImpact = await seedShot(orgA, aProjectId, "A update-impact target");
  aShotForDeleteImpact = await seedShot(orgA, aProjectId, "A delete-impact target");
  aShotForRawSql = await seedShot(orgA, aProjectId, "A raw-sql target");
  for (const contentHash of [A_TRANSCRIPT_HASH, A_TRANSCRIPT_HASH_2]) {
    await prisma.transcript.create({
      data: { id: `trs_${randomUUID()}`, ownerId: orgA, contentHash, model: "base.en", cuesJson: [{ start: 0, end: 1, text: "A's private transcript" }] },
    });
  }

  // ── org B's own data (the attacker needs legitimate rows to attack FROM)
  bProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: bProjectId, ownerId: orgB, name: "B campaign" } });
  bShotId = await seedShot(orgB, bProjectId, "B shot");
  bShotId2 = await seedShot(orgB, bProjectId, "B shot 2");
  const bAsset = await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgB, contentHash: "b".repeat(64), ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
  const bGen = await prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgB, projectId: bProjectId, assetId: bAsset.id, source: "GENERATED", entitySnapshot: {} } });
  bGenerationId = bGen.id;
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — the guard is armed (control)", () => {
  // If either of these two fails, the whole file is meaningless: it means the guard
  // is not in strict mode, or the harness never reached the database.
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
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — the guard is a PRESENCE check, not an IDENTITY check", () => {
  // This block is #459's executable statement. A Prisma client extension has no
  // authenticated principal, so it can only ask
  // "is there an ownerId?", never "is it YOUR ownerId?". #320 (adding update/upsert/
  // delete to CHECKED_OPS) does NOT close this family. The only identity authority is
  // the requireOwner()-derived ownerId at the call site — proven by the product-surface
  // describe block at the bottom of this file.
  it("a FORGED ownerId passes the guard: updateMany mutates org A's row", async () => {
    const { count } = await prisma.shot.updateMany({
      where: { ownerId: orgA, id: aShotForForgedUpdate },
      data: { title: "pwned by B via forged ownerId" },
    });
    expect(count).toBe(1); // ← the guard did not fire; the write landed on org A
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForForgedUpdate }, select: { title: true } });
    expect(after?.title).toBe("pwned by B via forged ownerId");
  });

  it("a FORGED ownerId passes the guard: deleteMany removes org A's row", async () => {
    const { count } = await prisma.shot.deleteMany({ where: { ownerId: orgA, id: aShotForForgedDelete } });
    expect(count).toBe(1); // ← destructive, and the guard never fired
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForForgedDelete }, select: { id: true } });
    expect(after).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — #320: unique-key writes are not checked at all", () => {
  // CHECKED_OPS = {findMany, findFirst, findFirstOrThrow, updateMany, deleteMany}.
  // `update` / `upsert` / `delete` are absent, so these three reach org A's rows with
  // no guard involvement whatsoever. Each gap is stated TWICE: an it.fails tripwire that
  // goes RED the moment #320 lands, and a plain-green `[#320 impact]` case on its own
  // throwaway row that READS BACK the damage — because `rejects.toThrow()` alone cannot
  // tell "the call resolved" from "the call threw something else".

  it.fails("[#320] Shot.update by id on org A's row MUST be refused", async () => {
    await expect(
      prisma.shot.update({ where: { id: aShotForUncheckedUpdate }, data: { title: "pwned by B via update" } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("[#320 impact] Shot.update by id really DOES rewrite org A's row today", async () => {
    // The read-back oracle for the it.fails case above, on its own row: proves the write
    // lands (not merely that some error was absent).
    await prisma.shot.update({ where: { id: aShotForUpdateImpact }, data: { title: "pwned by B via update" } });
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForUpdateImpact }, select: { title: true } });
    expect(after?.title).toBe("pwned by B via update"); // ← org A's row, rewritten, no guard involved
  });

  it.fails("[#320] Shot.delete by id on org A's row MUST be refused", async () => {
    await expect(
      prisma.shot.delete({ where: { id: aShotForUncheckedDelete } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("[#320 impact] Shot.delete by id really DOES remove org A's row today", async () => {
    await prisma.shot.delete({ where: { id: aShotForDeleteImpact } });
    const gone = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForDeleteImpact }, select: { id: true } });
    expect(gone).toBeNull(); // ← destructive, and the guard never saw it
  });

  it.fails("[#320] Transcript.upsert by contentHash_model (no ownerId in the key) MUST be refused", async () => {
    // Transcript's only unique key is @@unique([contentHash, model]) — NO ownerId.
    // Cross-tenant dedup is deliberate (two merchants uploading the same video share one
    // row), which makes this the structurally hardest case in the file: #320 must decide
    // whether the guard refuses it or the schema grows a per-org key.
    await expect(
      prisma.transcript.upsert({
        where: { contentHash_model: { contentHash: A_TRANSCRIPT_HASH_2, model: "base.en" } },
        update: { ownerId: orgB, cuesJson: [{ start: 0, end: 1, text: "pwned by B" }] },
        create: { id: `trs_${randomUUID()}`, ownerId: orgB, contentHash: A_TRANSCRIPT_HASH_2, model: "base.en", cuesJson: [] },
      }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("[#320 impact] the same Transcript upsert TAKES OVER org A's cached row today", async () => {
    // The executable proof of what the it.fails case above is protecting against: the row
    // A owns is rewritten in place — its ownerId AND its content now belong to B.
    await prisma.transcript.upsert({
      where: { contentHash_model: { contentHash: A_TRANSCRIPT_HASH, model: "base.en" } },
      update: { ownerId: orgB, cuesJson: [{ start: 0, end: 1, text: "pwned by B" }] },
      create: { id: `trs_${randomUUID()}`, ownerId: orgB, contentHash: A_TRANSCRIPT_HASH, model: "base.en", cuesJson: [] },
    });
    const row = await prisma.transcript.findUnique({ where: { contentHash_model: { contentHash: A_TRANSCRIPT_HASH, model: "base.en" } } });
    expect(row?.ownerId).toBe(orgB); // ← org A's cache entry was taken over
  });

  it("[scope note] a FORGED compound unique key survives #320's presence check", async () => {
    // Asset's unique key is @@unique([ownerId, contentHash]). Even after #320 teaches
    // whereHasOwnerId() to look inside compound-unique wrappers, `{ ownerId_contentHash:
    // { ownerId: <org A>, ... } }` still SATISFIES a presence check — so this write stays
    // possible. It exists to stop anyone reading "#320 landed" as "cross-tenant writes are
    // now impossible". It stays green ONLY IF #320 descends into compound-unique wrappers;
    // a fix that adds `upsert` to CHECKED_OPS without that descent turns this case red (see
    // the header's coupled-case list).
    const asset = await prisma.asset.upsert({
      where: { ownerId_contentHash: { ownerId: orgA, contentHash: aAssetHash } },
      update: { originalFilename: "pwned-by-B.png" },
      create: { id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: aAssetHash, ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" },
    });
    expect(asset.ownerId).toBe(orgA);
    expect(asset.originalFilename).toBe("pwned-by-B.png"); // ← org A's asset, mutated
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — blind spots a client extension cannot see", () => {
  it("[blind spot] a NESTED updateMany is never inspected by the guard", async () => {
    // Prisma extensions fire on the TOP-LEVEL operation only. This nested Shot.updateMany
    // carries no ownerId yet raises no tenant-guard error. It is relation-scoped (it can
    // only reach bProject's own shots), so it is a guard blind spot rather than a leak —
    // this case pins that boundary so a future nested-write path cannot silently rely on
    // a guard that was never watching.
    await expect(
      prisma.project.update({
        where: { id: bProjectId },
        data: { shots: { updateMany: { where: {}, data: { description: "nested write" } } } },
      }),
    ).resolves.toBeDefined();
    const aWitness = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotId }, select: { description: true } });
    expect(aWitness?.description).toBe(""); // org A unaffected — blind spot, not a leak
  });

  it("[blind spot] $executeRaw bypasses the extension entirely and DOES write org A's row", async () => {
    const rows = await prisma.$executeRaw`UPDATE "Shot" SET "title" = 'pwned by B via raw SQL' WHERE "id" = ${aShotForRawSql}`;
    expect(rows).toBe(1); // ← no tenant-guard involvement is possible on raw SQL
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForRawSql }, select: { title: true } });
    expect(after?.title).toBe("pwned by B via raw SQL");
  });

  it("[action] addEntityAlias refuses BEFORE its raw SQL is ever reached", async () => {
    // HONEST SCOPE: this is a member of the action-refusal family, not a raw-SQL test. The
    // Prisma pre-check at actions.ts:394-395 returns first, so the $executeRaw at :398 never
    // runs for this input — deleting `AND "ownerId"` from that statement would leave THIS
    // case green. The predicate itself is tested by the next case.
    await asUser(B_EMAIL);
    const res = await actions.addEntityAlias(aEntityId, "pwned");
    expect(res).toEqual({ error: "Entity not found." });
    const entity = await prisma.entity.findFirst({ where: { ownerId: orgA, id: aEntityId }, select: { aliases: true } });
    expect(entity?.aliases).toEqual([]);
  });

  it("[control] the raw-SQL ownerId predicate is what actually refuses the write", async () => {
    // addEntityAlias/removeEntityAlias are the app's raw-SQL WRITE sites on a tenant table
    // (otto-canvas-bridge's CanvasNode INSERT is the other; every remaining $executeRaw in
    // apps/web is an advisory lock). They are the reason the blind spot above is not an open
    // door — but only because of the `AND "ownerId" = …` clause, which nothing else checks:
    // $executeRaw is invisible to the extension by construction. So run the EXACT statement
    // shape from actions.ts:398 twice, changing ONE value — the ownerId — and let the row
    // counts speak. Cross-tenant first.
    const refused = await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_append("aliases", ${"pwned"}) WHERE "id" = ${aEntityId} AND "ownerId" = ${orgB} AND "deletedAt" IS NULL AND NOT (${"pwned"} = ANY("aliases"))`;
    expect(refused).toBe(0); // ← the predicate refused; no guard was involved
    const untouched = await prisma.entity.findFirst({ where: { ownerId: orgA, id: aEntityId }, select: { aliases: true } });
    expect(untouched?.aliases).toEqual([]);

    // Positive control — same statement, org A's real ownerId. Without this, `0 rows` could
    // just mean the statement was malformed or the id was wrong, and the case would be vacuous.
    const landed = await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_append("aliases", ${"pwned"}) WHERE "id" = ${aEntityId} AND "ownerId" = ${orgA} AND "deletedAt" IS NULL AND NOT (${"pwned"} = ANY("aliases"))`;
    expect(landed).toBe(1); // ← identical SQL, only the ownerId differs
    const mutated = await prisma.entity.findFirst({ where: { ownerId: orgA, id: aEntityId }, select: { aliases: true } });
    expect(mutated?.aliases).toEqual(["pwned"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — #317: no cross-tenant composite foreign keys", () => {
  it("[#317 impact] org B links org A's Entity, then reads it back through its OWN owner-scoped query", async () => {
    // ShotEntityRef.entityId is a plain FK to Entity.id with no ownerId component, so
    // nothing at the DB level stops org B pointing it at org A's row. The consequence is
    // a READ leak reached through a WRITE: getShots(orgB, …) includes entityRefs.entity.
    await prisma.shotEntityRef.create({ data: { shotId: bShotId, entityId: aEntityId, ownerId: orgB } });
    try {
      const shots = await data.getShots(orgB, bProjectId);
      const target = shots.find((s) => s.id === bShotId);
      const leaked = target?.entityRefs.map((r) => r.entity).find((e) => e.id === aEntityId);
      expect(leaked).toBeDefined();
      expect(leaked?.ownerId).toBe(orgA);                       // ← org A's row, in org B's response
      expect(leaked?.name).toBe("A's secret brand character");  // ← org A's content, readable
    } finally {
      await prisma.shotEntityRef.deleteMany({ where: { ownerId: orgB, shotId: bShotId } });
    }
  });

  it.fails("[#317] the cross-tenant FK write MUST be rejected by the database", async () => {
    // A composite FK (shotId+ownerId → Shot, entityId+ownerId → Entity) would make this a
    // constraint violation — exactly what ConsentEvent(contactId, ownerId) → Contact(id,
    // ownerId) already does on the CRM side; Shot/Entity lack even the @@unique([id,
    // ownerId]) that FK needs. Today it succeeds. The created row is cleaned up in afterAll —
    // an it.fails body stops at the assertion, so no in-body cleanup would run.
    await expect(
      prisma.shotEntityRef.create({ data: { shotId: bShotId2, entityId: aEntityId, ownerId: orgB } }),
    ).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — the real product surface (what a merchant can actually drive)", () => {
  // These three exported server actions are the highest-risk write paths a browser can
  // reach with attacker-chosen ids:
  //   deleteProject      — the largest blast radius in the app (hard-deletes a campaign
  //                        and cascades deleteMany across ~12 tables)
  //   saveShotPrompt     — the only place the product defends against the #317 shape
  //                        (its IDOR guard on @-mentioned entity ids)
  //   attachGeneration   — a two-object write whose two ids arrive from independent
  //                        client inputs, so a missed check cross-links tenants
  // All of them are protected by call-site discipline (requireOwner → findFirst by
  // ownerId → write), NOT by the tenant guard. That is exactly why these cases are green
  // and the guard-level cases above are not: the app is fail-closed, the backstop is not.

  it("deleteProject: B cannot delete A's campaign", async () => {
    await asUser(B_EMAIL);
    expect(await actions.deleteProject(aProjectId)).toEqual({ error: "Project not found." });
    const still = await prisma.project.findFirst({ where: { ownerId: orgA, id: aProjectId }, select: { id: true } });
    expect(still).not.toBeNull();
    const shotsLeft = await prisma.shot.findMany({ where: { ownerId: orgA, projectId: aProjectId }, select: { id: true } });
    expect(shotsLeft.length).toBeGreaterThan(0);
  });

  it("saveShotPrompt: B cannot write A's shot", async () => {
    await asUser(B_EMAIL);
    const res = await actions.saveShotPrompt(aShotId, JSON.stringify({ type: "doc" }), "pwned by B", []);
    expect(res).toEqual({ error: "Shot not found." });
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotId }, select: { description: true } });
    expect(after?.description).toBe("");
  });

  it("saveShotPrompt IDOR guard: B cannot link A's entity into B's OWN shot", async () => {
    // The product-layer defense against #317. B owns bShotId, so the shot check passes —
    // only the entity-ownership check stands between B and org A's data.
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
  // BOTH orgs' refs go first, before ANY org's entity delete. The #317 case leaves a
  // ShotEntityRef owned by org B that POINTS AT org A's Entity, so cleaning refs per-owner
  // inside the loop below would run entity.deleteMany(orgA) while org B's ref still
  // references it → ON DELETE RESTRICT → swallowed by .catch() → one org-A Entity leaked
  // on every run.
  for (const ownerId of [orgA, orgB]) {
    await prisma.shotEntityRef.deleteMany({ where: { ownerId } }).catch(() => {});
  }
  // best-effort cleanup of both orgs' seeded rows (ON DELETE RESTRICT means order matters)
  for (const ownerId of [orgA, orgB]) {
    await prisma.generation.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.shot.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.transcript.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.referenceImage.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.entity.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.asset.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.project.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.actionEvent.deleteMany({ where: { ownerId } }).catch(() => {});
  }
});
