/**
 * #738 — the merchant's own actions, run the way the merchant runs them.
 *
 * WHY THIS FILE EXISTS. `6b6c537c` (#626) added `count` / `aggregate` / `groupBy` / `findUnique`
 * to the tenant guard's SCOPED_WHERE_OPS. From that commit on, a call site with NO principal
 * frame throws unless its `where` literally names `ownerId`. 151 of the 168 `requireOwner()`
 * sites had no frame, so the guard started refusing the merchant's own work — silently where a
 * `try/catch` swallowed it (Library delete: the card left the screen, the row was never touched)
 * and loudly where it did not (the refgen refund transaction).
 *
 * Nothing caught it because every existing test for these exports mocks Prisma away, so the
 * guard was never in the loop. THESE tests keep the guard in the loop: only the session is
 * mocked — `requireOwner`, the real Prisma client with `withTenantGuard`, and the real server
 * actions all run against a real database.
 *
 * The assertions are deliberately about the DATABASE AFTER THE FACT, never about "the action
 * returned ok" — the whole defect was an action that returned ok while the row survived.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  isImpersonating: async () => false,
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin: () => false, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** The queue is the ONLY thing the refund test needs to break — see its own describe block. */
const mockGetBoss = vi.fn();
vi.mock("@/lib/queue", () => ({ getBoss: mockGetBoss }));

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { softDeleteEntity, createProject } = await import("@/lib/actions");
const { startRefGen } = await import("@/lib/refgen-actions");
const { getEntities } = await import("@/lib/data");

const MERCHANT = `w4t-merchant-${randomUUID()}@fikirtive.test`;
const NEIGHBOUR = `w4t-neighbour-${randomUUID()}@fikirtive.test`;
let merchantOrg: string;
let neighbourOrg: string;

/** Sign in as `email` and hand back the org `requireOwner()` resolves for it. */
async function signIn(email: string): Promise<string> {
  mockAuth.mockResolvedValue({ user: { email } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = `${MERCHANT},${NEIGHBOUR}`;
  for (const email of [MERCHANT, NEIGHBOUR]) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `usr_${randomUUID()}`, email },
    });
  }
  merchantOrg = await signIn(MERCHANT);
  neighbourOrg = await signIn(NEIGHBOUR);
  expect(merchantOrg).not.toBe(neighbourOrg);
});

beforeEach(async () => {
  await signIn(MERCHANT);
});

afterAll(async () => {
  for (const ownerId of [merchantOrg, neighbourOrg]) {
    await prisma.shotEntityRef.deleteMany({ where: { ownerId } });
    await prisma.shot.deleteMany({ where: { ownerId } });
    // 演员库(CREATE-A10):org 引导时会给这个租户播五名演员,连带十张 ReferenceImage。
    // 它们挂在下面这些 Entity 上,所以要先摘引用再删元素 —— 否则收尾会撞 FK。
    await prisma.referenceImage.deleteMany({ where: { ownerId } });
    await prisma.entity.deleteMany({ where: { ownerId } });
    await prisma.refGenJob.deleteMany({ where: { ownerId } });
    await prisma.actionEvent.deleteMany({ where: { ownerId } });
    await prisma.creditLedger.deleteMany({ where: { orgId: ownerId } });
    await prisma.project.deleteMany({ where: { ownerId } });
  }
});

/** One Cast card in the Library, exactly as `createEntity` leaves it. */
async function seedEntity(ownerId: string, name = "Aisha owner"): Promise<string> {
  const id = `ent_${randomUUID()}`;
  await prisma.entity.create({ data: { id, ownerId, name, type: "CHARACTER" } });
  return id;
}

/** What a page reload would show: the row as it stands in the database. */
async function reloadEntity(entityId: string) {
  return prisma.entity.findFirst({
    where: { id: entityId, ownerId: { not: "" } },
    select: { id: true, deletedAt: true },
  });
}

describe("#738 — Library delete actually deletes", () => {
  it("leaves the row soft-deleted, so a reload does not bring the card back", async () => {
    const entityId = await seedEntity(merchantOrg);
    expect((await reloadEntity(entityId))?.deletedAt).toBeNull();

    const result = await softDeleteEntity(entityId);

    // The action reports success…
    expect(result).toMatchObject({ ok: true });
    // …and the DATABASE agrees. This is the assertion the defect failed: on `1d4fb302`
    // the action threw at its first `shotEntityRef.count` and the row was never touched.
    const reloaded = await reloadEntity(entityId);
    expect(reloaded, "the entity row vanished entirely — soft delete must keep it").not.toBeNull();
    expect(reloaded!.deletedAt, "deleted on screen but still live in the database").not.toBeNull();
  });

  it("still counts the shot references it reports back", async () => {
    const project = await createProject("Frame check");
    if ("error" in project) throw new Error(project.error);
    const entityId = await seedEntity(merchantOrg, "Referenced cast");
    const shotId = `sht_${randomUUID()}`;
    await prisma.shot.create({
      data: { id: shotId, ownerId: merchantOrg, projectId: project.id, number: 1 },
    });
    await prisma.shotEntityRef.create({ data: { ownerId: merchantOrg, shotId, entityId } });

    const result = await softDeleteEntity(entityId);

    expect(result).toMatchObject({ ok: true, shotRefs: 1 });
    expect((await reloadEntity(entityId))!.deletedAt).not.toBeNull();

    await prisma.shotEntityRef.deleteMany({ where: { ownerId: merchantOrg, shotId } });
    await prisma.shot.deleteMany({ where: { ownerId: merchantOrg, id: shotId } });
  });
});

describe("#738 — a neighbour's Library is still out of reach", () => {
  /** This block is GREEN BEFORE THE FIX AND MUST STAY GREEN AFTER. It is here so the fix
   *  cannot buy availability by loosening the boundary: whatever the frame does for the
   *  merchant's own rows, another tenant's rows must stay untouched and unreadable.
   *
   *  The assertions are about OUTCOMES, not messages — before the fix the refusal arrives as
   *  a guard throw, after it as "Entity not found."; either way the row must survive. */
  it("never soft-deletes another tenant's entity, however the refusal arrives", async () => {
    const neighbourEntity = await seedEntity(neighbourOrg, "Not yours");

    await signIn(MERCHANT);
    const outcome = await softDeleteEntity(neighbourEntity).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));

    expect(outcome, "the merchant's delete of a foreign row reported success").not.toMatchObject({
      ok: true,
    });
    const survivor = await reloadEntity(neighbourEntity);
    expect(survivor!.deletedAt, "a foreign tenant's row was soft-deleted").toBeNull();
  });

  it("never lists another tenant's entities in the merchant's Library", async () => {
    const neighbourEntity = await seedEntity(neighbourOrg, "Invisible to the merchant");

    await signIn(MERCHANT);
    const rows = await getEntities(merchantOrg);

    expect(rows.map((row) => row.id)).not.toContain(neighbourEntity);
  });

  it("refuses to start a paid generation against another tenant's element", async () => {
    const neighbourEntity = await seedEntity(neighbourOrg, "Not yours either");

    await signIn(MERCHANT);
    const result = await startRefGen({
      entityId: neighbourEntity,
      prompt: "a portrait",
      count: 1,
      model: "seedream",
      mode: "BASE",
    });

    expect(result).toEqual({ error: "Element not found." });
    const jobs = await prisma.refGenJob.count({
      where: { ownerId: merchantOrg, entityId: neighbourEntity },
    });
    expect(jobs, "a paid job was created against a foreign tenant's element").toBe(0);
  });
});

describe("#738 — the money path: startRefGen when the queue is down", () => {
  /** The reserve/refund pair is the P1 in this ticket. `startRefGen` reserves credits in the
   *  same transaction as the job insert, then enqueues. If the enqueue throws, the catch runs
   *  a transaction that terminal-fails the job AND releases the hold. That transaction's first
   *  statement is `tx.refGenJob.update({ where: { id: job.id } })` — no `ownerId`, no frame —
   *  so on `1d4fb302` the guard threw INSIDE the catch: the merchant's credits stayed reserved
   *  and the friendly message never arrived. */
  beforeEach(async () => {
    mockGetBoss.mockReset();
    await prisma.creditAccount.upsert({
      where: { orgId: merchantOrg },
      update: { balance: 500, reserved: 0 },
      create: { orgId: merchantOrg, balance: 500, reserved: 0 },
    });
    await prisma.creditLedger.deleteMany({ where: { orgId: merchantOrg } });
  });

  it("releases the hold and says so, instead of throwing with the credits still held", async () => {
    mockGetBoss.mockRejectedValue(new Error("queue unavailable"));
    const entityId = await seedEntity(merchantOrg, "Money path");

    const result = await startRefGen({
      entityId,
      prompt: "a portrait",
      count: 1,
      model: "seedream",
      mode: "BASE",
    });

    expect(result).toEqual({ error: "Could not reach the generation queue — is the worker up?" });

    const job = await prisma.refGenJob.findFirst({
      where: { ownerId: merchantOrg, entityId },
      select: { id: true, status: true },
    });
    expect(job, "no job row at all — the reserve transaction never committed").not.toBeNull();
    expect(job!.status, "the job was left QUEUED with nothing to run it").toBe("FAILED");

    const account = await prisma.creditAccount.findUnique({ where: { orgId: merchantOrg } });
    expect(account!.reserved, "the merchant's credits are still held for a job that never ran").toBe(0);
    expect(account!.balance, "the merchant paid for a generation that never happened").toBe(500);
    const refunds = await prisma.creditLedger.count({
      where: { orgId: merchantOrg, refId: job!.id, kind: "REFUND" },
    });
    expect(refunds, "no REFUND row — the ledger and the account disagree").toBe(1);
  });
});
