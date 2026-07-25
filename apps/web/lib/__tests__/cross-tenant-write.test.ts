/**
 * Cross-tenant WRITE red-team suite — the write-side twin of isolation.test.ts.
 *
 * WHAT THIS PROVES (green, always executed):
 *  - The tenant guard is ARMED under NODE_ENV=test: `updateMany`/`deleteMany` with no
 *    ownerId filter THROWS, and org A's row is untouched. Checked on TWO models (Shot
 *    and Project) so that a model silently dropping out of TENANT_MODELS is caught.
 *  - The product surface is fail-closed: org B calling the real exported server actions
 *    (deleteProject / renameProject / createShot / saveShotPrompt / attachGeneration)
 *    with org A's ids gets a "not found" refusal and writes nothing. That is the actual
 *    attack path a merchant can drive from a browser, so it is tested through the real
 *    requireOwner() path.
 *  - saveShotPrompt's IDOR guard stops the cross-tenant FOREIGN KEY shape at the product
 *    layer: org B cannot link org A's Entity into org B's own Shot.
 *  - The raw-SQL ownerId predicate is load-bearing: the same statement differing only in
 *    ownerId touches 0 rows cross-tenant and 1 row same-tenant.
 *  - Transcript — a GLOBAL content-addressed cache by design — is safe because its READ
 *    path is owner-gated: a tenant reaches a cached transcript only for content it
 *    demonstrably possesses. See the Transcript describe block for the full ruling.
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
 *    The tripwires cover THREE edges (ShotEntityRef→Entity, Shot→Project,
 *    Generation→Shot) precisely so that fixing one edge cannot flip the marker and be
 *    read as "#317 done"; the remaining edges are enumerated in that describe block.
 *    NOTE: the pattern is NOT absent from the database — the newer CRM/consent tables
 *    (Contact, ChannelScope, ChannelConnection, Membership, …) already ship
 *    `@@unique([id, ownerId])` + `FOREIGN KEY (x, ownerId) REFERENCES y(id, ownerId)`.
 *    #317 is about extending that existing pattern backwards, not inventing it.
 *  - Transcript is NOT in this family. Its global `@@unique([contentHash, model])` is a
 *    deliberate cross-tenant cache, not a leak (schema.prisma:378-383,
 *    actions.ts:1092-1099). #320 must EXEMPT it, not refuse it — see its describe block.
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
 *  whether the promise RESOLVED or rejected for an unrelated reason. Two rules keep it
 *  honest, and both must be preserved by anyone editing this file:
 *   1. MATCH THE SPECIFIC FAILURE. A guard tripwire matches /tenant-guard/; a database
 *      tripwire matches the P2003 foreign-key code (and `[control] the #317 matcher`
 *      proves that matcher really fires on a real FK violation, so the #317 tripwires
 *      cannot be satisfied by an unrelated DB error).
 *   2. PAIR IT WITH A GREEN READ-BACK ON THE SAME ROW. Each `.fails` body stays a single
 *      assertion; the following `[… impact]` case reads back THAT EXACT ROW and proves
 *      the write really landed. Same row, deliberately: a row-specific failure inside the
 *      tripwire would otherwise hide behind a companion that used a different row.
 *  ALSO: those green halves are coupled to their gaps by construction. Once #320 lands,
 *  `[#320 impact] Shot.update` and `[#320 impact] Shot.delete` start failing (their rows
 *  survive), and `[scope note] forged compound unique key` stays green only if the fix
 *  descends into compound-unique wrappers. Once #317 lands, `[#317 impact]` goes red too —
 *  its shotEntityRef.create becomes a constraint violation. Expect both PRs to revisit
 *  this file in more places than just removing `.fails` markers.
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
const { storageKey, storageKeyToSrc } = await import("@fikirtive/core");

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
let aShotForUncheckedUpdate: string; // throwaway — the #320 `update` pair clobbers it
let aShotForUncheckedDelete: string; // throwaway — the #320 `delete` pair removes it
let aShotForRawSql: string;          // throwaway — the $executeRaw case clobbers it
let aSrc: string;                    // A's content-addressed src (/files/u/<orgA>/<hash>.png)
// The cached transcript's key is GLOBAL (@@unique([contentHash, model]) — no ownerId), so
// A's content hash is randomised per run: a fixed hash would collide with a leftover row
// from an earlier run (or another test file) and break seeding.
const A_TRANSCRIPT_CUES = [{ startMs: 0, lengthMs: 1000, text: "A's private transcript" }];
// org B — the attacker
let bProjectId: string, bShotId: string, bShotId2: string, bGenerationId: string, bAssetId: string;
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
  aShotForRawSql = await seedShot(orgA, aProjectId, "A raw-sql target");
  // the cached transcript for A's content, in the REAL CaptionCue shape (startMs/lengthMs/
  // text) — the wrong shape would fail getTranscript's zod parse and silently return [].
  await prisma.transcript.create({
    data: { id: `trs_${randomUUID()}`, ownerId: orgA, contentHash: aAssetHash, model: "base.en", cuesJson: A_TRANSCRIPT_CUES },
  });

  // ── org B's own data (the attacker needs legitimate rows to attack FROM)
  bProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: bProjectId, ownerId: orgB, name: "B campaign" } });
  bShotId = await seedShot(orgB, bProjectId, "B shot");
  bShotId2 = await seedShot(orgB, bProjectId, "B shot 2");
  const bAsset = await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgB, contentHash: "b".repeat(64), ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
  bAssetId = bAsset.id;
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
  // goes RED the moment #320 lands, and a plain-green `[#320 impact]` case that reads back
  // THE SAME ROW the tripwire targeted — because `rejects.toThrow()` alone cannot tell "the
  // call resolved" from "the call threw something else about that row".

  it.fails("[#320] Shot.update by id on org A's row MUST be refused", async () => {
    await expect(
      prisma.shot.update({ where: { id: aShotForUncheckedUpdate }, data: { title: "pwned by B via update" } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("[#320 impact] the update above really DID rewrite org A's row", async () => {
    // The oracle for the tripwire directly above, reading back THE SAME ROW it targeted.
    // If that update had failed for a row-specific reason (missing row, constraint, …) the
    // tripwire would still be green — but this read-back would catch it, because the title
    // would still be the seeded one.
    const after = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForUncheckedUpdate }, select: { title: true } });
    expect(after?.title).toBe("pwned by B via update"); // ← org A's row, rewritten, no guard involved
  });

  it.fails("[#320] Shot.delete by id on org A's row MUST be refused", async () => {
    await expect(
      prisma.shot.delete({ where: { id: aShotForUncheckedDelete } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("[#320 impact] the delete above really DID remove org A's row", async () => {
    // Same-row oracle for the tripwire directly above. beforeAll's `prisma.shot.create`
    // throws on failure, so the row provably existed before that delete ran.
    const gone = await prisma.shot.findFirst({ where: { ownerId: orgA, id: aShotForUncheckedDelete }, select: { id: true } });
    expect(gone).toBeNull(); // ← destructive, and the guard never saw it
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
describe("Transcript — a GLOBAL content-addressed cache, gated at the READ path", () => {
  // WHY THERE IS NO #320 TRIPWIRE HERE (read this before adding one).
  // Transcript's `@@unique([contentHash, model])` carries no ownerId ON PURPOSE. It is a
  // whisper.cpp CACHE, not tenant data: transcription is deterministic for fixed
  // (audio bytes, model, flags), so two tenants holding the same bytes derive the SAME
  // cues — one "overwriting" the other writes identical content.
  //   schema.prisma:380-383 — "Cached whisper.cpp transcript, keyed by (contentHash,
  //                            model). Deterministic … → cache is always valid"
  //   actions.ts:1092-1099  — global-but-owner-gated is the deliberate P0 choice; per-org
  //                           is a P3 schema decision, and "a per-org filter here without
  //                           changing that unique would break a second org's write"
  //   caption.ts:60,100,163 — the worker reads and upserts this cache UNSCOPED by design
  // Transcript stays in TENANT_MODELS — its LIST queries are correctly owner-scoped today.
  // What #320 must NOT do is extend that to the global-unique path: adding `upsert` to
  // CHECKED_OPS without a documented per-operation exemption for Transcript would break the
  // worker's caption path outright. Exemption, with a written reason, not refusal. The row's
  // `ownerId` column is first-writer bookkeeping, not an authority field. That is precisely
  // why the security property lives in the READ path, and why these cases pin THAT.
  // ORDER MATTERS: case 4 gives org B the same bytes, which legitimately opens the cache to
  // it. Cases 2 and 3 must run before it.

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

  // THREE EDGES, NOT ONE. The creative-core graph has several ID-only relations, and each
  // needs its own composite FK before #317 can be called done. If this file tripwired only
  // ShotEntityRef→Entity, shipping that ONE constraint would flip the marker red and read as
  // "#317 complete" while Shot→Project and Generation→Shot stayed wide open. Edges still
  // uncovered here, for whoever implements #317: Generation→Project, Generation→Asset,
  // ShotEntityRef→Shot, ReferenceImage→Entity/Asset, EntityVariant→Entity.
  //
  // Every tripwire below matches the P2003 foreign-key code specifically — an unrelated DB
  // error must NOT read as "the gap closed". The control case proves that matcher fires.

  it("[control] the #317 matcher really does fire on a foreign-key violation", async () => {
    // Without this, every `.fails` below could be green because P2003 never matches anything
    // — the tripwires would be dead and nobody would notice.
    await expect(
      prisma.shotEntityRef.create({ data: { shotId: bShotId, entityId: `ent_missing_${randomUUID()}`, ownerId: orgB } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it.fails("[#317 edge 1] ShotEntityRef.entityId → Entity: B's ref at A's entity MUST be rejected", async () => {
    // A composite FK (entityId+ownerId → Entity) would make this a constraint violation —
    // exactly what ConsentEvent(contactId, ownerId) → Contact(id, ownerId) already does on
    // the CRM side; Shot/Entity lack even the @@unique([id, ownerId]) that FK needs. Today it
    // succeeds. The created row is cleaned up in afterAll — an it.fails body stops at the
    // assertion, so no in-body cleanup would run.
    await expect(
      prisma.shotEntityRef.create({ data: { shotId: bShotId2, entityId: aEntityId, ownerId: orgB } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it.fails("[#317 edge 2] Shot.projectId → Project: B's shot inside A's campaign MUST be rejected", async () => {
    // schema.prisma:219 — `project Project @relation(fields: [projectId], references: [id])`,
    // no ownerId component. A B-owned Shot can therefore live inside org A's campaign.
    await expect(
      prisma.shot.create({ data: { id: `sht_${randomUUID()}`, ownerId: orgB, projectId: aProjectId, number: shotSeq++, title: "B shot in A's campaign" } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it.fails("[#317 edge 3] Generation.shotId → Shot: B's generation on A's shot MUST be rejected", async () => {
    // schema.prisma:277 — `shot Shot? @relation(fields: [shotId], references: [id], onDelete:
    // Restrict)`, again ID-only. This edge is worse than a dangling pointer: the RESTRICT
    // means B's row also BLOCKS deletion of A's shot until B's row goes away.
    await expect(
      prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgB, projectId: bProjectId, assetId: bAssetId, shotId: aShotId, source: "GENERATED", entitySnapshot: {} } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("cross-tenant write — the real product surface (what a merchant can actually drive)", () => {
  // These exported server actions are the highest-risk write paths a browser can reach
  // with attacker-chosen ids:
  //   deleteProject      — the largest blast radius in the app (hard-deletes a campaign
  //                        and cascades deleteMany across ~12 tables)
  //   renameProject      — the smallest-looking one, and therefore the easiest to ship
  //                        with an unscoped lookup nobody notices
  //   createShot         — a CREATE whose parent id is attacker-chosen: an unscoped parent
  //                        lookup plants a B-owned row inside A's campaign (#317 edge 2)
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

  it("renameProject: B cannot rename A's campaign", async () => {
    // Mutation gap found by review: renameProject's lookup (actions.ts:276) is the ONLY thing
    // stopping this — dropping `ownerId` from it lets B rename A's campaign, and no other case
    // in this file calls renameProject.
    await asUser(B_EMAIL);
    expect(await actions.renameProject(aProjectId, "pwned by B")).toEqual({ error: "Project not found." });
    const after = await prisma.project.findFirst({ where: { ownerId: orgA, id: aProjectId }, select: { name: true } });
    expect(after?.name).toBe("A campaign");
  });

  it("createShot: B cannot create a shot inside A's campaign", async () => {
    // Mutation gap found by review: createShot's Project lookup (actions.ts:497) is the only
    // guard against a B-owned Shot landing in org A's campaign — the exact #317 edge-2 shape,
    // reached through the product surface instead of raw Prisma.
    // Measured as a DELTA, not an absolute: the `[#317 edge 2]` tripwire above deliberately
    // plants a B-owned Shot in A's campaign through raw Prisma (that is the gap it pins), so
    // "zero such rows" is not true here. What createShot is answerable for is not ADDING one.
    await asUser(B_EMAIL);
    const before = await prisma.shot.count({ where: { ownerId: orgB, projectId: aProjectId } });
    expect(await actions.createShot(aProjectId)).toEqual({ error: "Project not found." });
    const after = await prisma.shot.count({ where: { ownerId: orgB, projectId: aProjectId } });
    expect(after).toBe(before); // createShot planted nothing inside A's campaign
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
  // TABLE BY TABLE ACROSS BOTH ORGS — never owner-by-owner. Cross-tenant edges are this
  // file's whole subject: the #317 tripwires deliberately leave B-owned children pointing at
  // A-owned parents (ShotEntityRef→A's Entity, Shot→A's Project, Generation→A's Shot). An
  // owner-by-owner sweep would try to delete A's parents while B's children still reference
  // them → ON DELETE RESTRICT → swallowed by the best-effort catch → silent row leak that
  // grows every run. Deleting each child table for BOTH orgs first is immune to that.
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
  await purge((ownerId) => prisma.entity.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.asset.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.project.deleteMany({ where: { ownerId } }));
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
