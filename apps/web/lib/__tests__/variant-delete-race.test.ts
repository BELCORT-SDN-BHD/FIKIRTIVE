/**
 * #781 r3 P1 — the delete/dispatch race, run for real against Postgres.
 *
 * The bug this closes is a money one. "Delete this variant" and "make it again" are two different
 * actions the SAME merchant can set off within milliseconds of each other — the Delete button and
 * Otto's own hands, or two tabs. In r2 the delete decided by COUNTING active jobs and only then
 * wrote the tombstone, with nothing joining the two: a re-run dispatched in between was invisible to
 * the count and unaffected by the write, so the merchant ended up charged for an image that lands on
 * a variant they can no longer see anywhere.
 *
 * A mock cannot prove that is fixed — mocks have no transactions, no row locks and no rollback, so
 * they can only show that the code is ARRANGED correctly (variant-spend-guards.test.ts does that).
 * What actually closes the window is Postgres: both actions now claim the same EntityVariant row
 * with an UPDATE at the top of their transaction, so the second one waits for the first to commit
 * and then re-evaluates against committed truth. This file runs them genuinely concurrently
 * (Promise.all over two connections) and checks the invariant that matters afterwards:
 *
 *     a tombstoned variant NEVER has a paid job in flight, in either interleaving.
 *
 * Plus the money ledger, which is the same statement said in credits: every reserve that exists
 * belongs to a job that exists, and a refused dispatch reserved nothing at all.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const h = vi.hoisted(() => ({
  ownerId: `org781race${Math.random().toString(36).slice(2, 10)}`,
  resolveDisabledModels: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({
  requireOwner: vi.fn(async () => ({ ownerId: h.ownerId, email: "merchant781@fikirtive.test" })),
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: async () => false }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: h.resolveDisabledModels }));
// The queue is not what is being tested and pg-boss is not running here; the dispatch is still the
// real one, including its transaction, its reserve and its claim.
vi.mock("../queue", () => ({ getBoss: vi.fn(async () => ({ send: vi.fn(async () => `q-${randomUUID()}`) })) }));

const { prisma } = await import("@fikirtive/db");
const { pricedRefgenCredits } = await import("@fikirtive/core");
const { deleteVariant, regenerateVariant } = await import("../refgen-actions");

const OWNER = h.ownerId;
const ENTITY = `ent-${randomUUID()}`;
const ASSET = `ast-${randomUUID()}`;
const COST = pricedRefgenCredits({ model: "seedream", count: 1 });
const START_BALANCE = 10_000_000;

let variantSeq = 0;
async function freshVariant(): Promise<string> {
  variantSeq += 1;
  const id = `var-${randomUUID()}`;
  await prisma.entityVariant.create({
    data: { id, ownerId: OWNER, entityId: ENTITY, name: `Look ${variantSeq}`, handle: `look-${variantSeq}`, prompt: "in a red evening gown" },
  });
  return id;
}

/** What actually ended up in the database for one variant. */
async function settled(variantId: string) {
  const [variant, jobs] = await Promise.all([
    prisma.entityVariant.findFirst({ where: { id: variantId, ownerId: OWNER }, select: { deletedAt: true } }),
    prisma.refGenJob.findMany({ where: { variantId, ownerId: OWNER }, select: { id: true, status: true } }),
  ]);
  return {
    tombstoned: variant?.deletedAt != null,
    activeJobs: jobs.filter((j) => j.status === "QUEUED" || j.status === "GENERATING"),
    jobs,
  };
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: OWNER, name: "Race shop" } });
  await prisma.creditAccount.create({ data: { orgId: OWNER, balance: START_BALANCE, reserved: 0 } });
  await prisma.asset.create({
    data: {
      id: ASSET, ownerId: OWNER, contentHash: randomUUID().replace(/-/g, "").repeat(2),
      ext: "png", mime: "image/png", sizeBytes: BigInt(10), originalFilename: "base.png", source: "UPLOAD",
    },
  });
  await prisma.entity.create({
    data: { id: ENTITY, ownerId: OWNER, type: "CHARACTER", name: "Aisyah", baseAssetId: ASSET },
  });
});

beforeEach(() => {
  h.resolveDisabledModels.mockResolvedValue({ disabled: new Set<string>() });
});

afterAll(async () => {
  await prisma.actionEvent.deleteMany({ where: { ownerId: OWNER } });
  await prisma.refGenJob.deleteMany({ where: { ownerId: OWNER } });
  await prisma.referenceImage.deleteMany({ where: { ownerId: OWNER } });
  await prisma.entityVariant.deleteMany({ where: { ownerId: OWNER } });
  await prisma.entity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.creditLedger.deleteMany({ where: { orgId: OWNER } });
  await prisma.creditAccount.deleteMany({ where: { orgId: OWNER } });
  await prisma.organization.deleteMany({ where: { id: OWNER } });
});

describe("delete and 'make it again', fired at the same moment", () => {
  it("NEVER leaves a paid job running on a deleted variant — 30 real races", async () => {
    const outcomes = { deleted: 0, refusedDelete: 0, dispatched: 0, refusedDispatch: 0 };

    for (let i = 0; i < 30; i++) {
      const variantId = await freshVariant();
      // Two independent server actions, two connections, no ordering imposed: exactly the
      // interleaving r2 lost the money to.
      const [del, regen] = await Promise.all([deleteVariant(variantId), regenerateVariant(variantId)]);
      const after = await settled(variantId);

      // ── the invariant ──────────────────────────────────────────────────────────────────────
      if (after.tombstoned) expect(after.activeJobs, `race ${i}: paid job left on a deleted variant`).toHaveLength(0);
      if (after.activeJobs.length > 0) expect(after.tombstoned, `race ${i}: variant deleted under a running job`).toBe(false);

      // ── and what each caller was told matches what the database did ────────────────────────
      if ("ok" in del) {
        outcomes.deleted += 1;
        expect(after.tombstoned).toBe(true);
      } else {
        outcomes.refusedDelete += 1;
        expect(after.tombstoned).toBe(false); // a refused delete rolls its own tombstone back
      }
      if ("jobId" in regen) {
        outcomes.dispatched += 1;
        expect(after.jobs.map((j) => j.id)).toContain(regen.jobId);
      } else {
        outcomes.refusedDispatch += 1;
        expect(after.jobs).toHaveLength(0); // a refused dispatch leaves no job row behind at all
      }
    }

    // every outcome is one of the four legal ones, and the two "both won" combinations are absent
    expect(outcomes.deleted + outcomes.refusedDelete).toBe(30);
    expect(outcomes.dispatched + outcomes.refusedDispatch).toBe(30);
  });

  it("charges for exactly the jobs that exist — no reserve without a job, no job without a reserve", async () => {
    const jobs = await prisma.refGenJob.findMany({ where: { ownerId: OWNER }, select: { id: true } });
    const reserves = await prisma.creditLedger.findMany({ where: { orgId: OWNER, kind: "RESERVE" }, select: { refId: true } });
    expect(new Set(reserves.map((r) => r.refId))).toEqual(new Set(jobs.map((j) => j.id)));

    const account = await prisma.creditAccount.findUnique({ where: { orgId: OWNER } });
    expect(account?.reserved).toBe(jobs.length * COST);
    expect(account?.balance).toBe(START_BALANCE - jobs.length * COST);
  });
});

describe("the same two orders, one after the other, so each refusal is stated on its own", () => {
  it("a re-run already in flight makes the delete refuse, and the variant stays", async () => {
    const variantId = await freshVariant();
    const started = await regenerateVariant(variantId);
    expect(started).toMatchObject({ jobId: expect.any(String) });

    const res = (await deleteVariant(variantId)) as { error: string };
    expect(res.error).toContain("still being made");
    const after = await settled(variantId);
    expect(after.tombstoned).toBe(false);
    expect(after.activeJobs).toHaveLength(1); // the paid work is untouched
  });

  it("a variant already deleted spends nothing on a re-run: no job, no reserve", async () => {
    const variantId = await freshVariant();
    expect(await deleteVariant(variantId)).toEqual({ ok: true });

    const before = await prisma.creditAccount.findUnique({ where: { orgId: OWNER } });
    const res = (await regenerateVariant(variantId)) as { error: string };
    expect(res).toHaveProperty("error");
    const after = await settled(variantId);
    expect(after.jobs).toHaveLength(0);
    const account = await prisma.creditAccount.findUnique({ where: { orgId: OWNER } });
    expect(account?.balance).toBe(before?.balance);
    expect(account?.reserved).toBe(before?.reserved);
  });
});
