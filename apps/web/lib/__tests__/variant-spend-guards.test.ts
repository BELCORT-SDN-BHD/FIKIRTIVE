/**
 * #781 r2 — the two money rules a styling variant lives by, tested where every caller meets them:
 * the shared action layer.
 *
 * [P1] A variant with a paid generation IN FLIGHT cannot be deleted. The worker re-checks the
 * variant before it spends, but a delete landing after that check still lets the paid image settle
 * onto a tombstoned variant — charged for, and nowhere the merchant can ever see it. Otto's port has
 * refused this since debt-69; the merchant's own Delete button called the action directly and did
 * not. A gate only one caller passes through is not a rule, so the rule is here now.
 *
 * [P2] A create that is REFUSED before any spend takes its half-made variant with it. createVariant
 * commits the EntityVariant row first and only then dispatches the paid job; when the dispatch is
 * refused (image generation turned off, not enough credits, queue unreachable) nothing is running
 * and nothing ever will be — the leftover row would sit there saying "Making this look…" forever,
 * and the retry after topping up would land on a suffixed name the merchant never chose.
 *
 * #781 r3 sharpens both of them, and this file pins the SHAPE of each fix — the interleaving
 * itself is run for real against Postgres in variant-delete-race.test.ts:
 *   [P1] the delete's "is anything running?" is no longer a read taken outside the write it guards.
 *        Both actions now claim the same EntityVariant row with an UPDATE at the top of their
 *        transaction, so the loser waits and then sees committed truth instead of a stale count.
 *   [P2] a rollback that cannot be written is reported (retry → console.error → an ActionEvent a
 *        sweep can find it by), never swallowed at warn level as "non-fatal".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // Where each call happened and in what order. A real Postgres transaction is the difference
  // between a guess and a decision, so "was this inside the transaction that writes the tombstone"
  // is the property worth asserting — a mock cannot roll anything back, but it can record that the
  // work was arranged so that Postgres would.
  trace: [] as Array<{ op: string; inTx: boolean }>,
  txDepth: { value: 0 },
  rolledBack: { value: 0 },
  requireOwner: vi.fn(),
  entityFindFirst: vi.fn(),
  assetFindFirst: vi.fn(),
  variantFindFirst: vi.fn(),
  variantCreate: vi.fn(),
  variantUpdateMany: vi.fn(),
  refImageUpdateMany: vi.fn(),
  refGenJobCount: vi.fn(),
  refGenJobFindFirst: vi.fn(),
  refGenJobFindMany: vi.fn(),
  refGenJobCreate: vi.fn(),
  refGenJobUpdate: vi.fn(),
  actionEventCreate: vi.fn(),
  reserveCredits: vi.fn(),
  refundReservation: vi.fn(),
  resolveDisabledModels: vi.fn(),
  getBoss: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({
  requireOwner: h.requireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: async () => false }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: h.resolveDisabledModels }));
vi.mock("../queue", () => ({ getBoss: h.getBoss }));
vi.mock("@fikirtive/db", () => {
  class InsufficientCredits extends Error {}
  // #524 — the variant dispatch path now tells the merchant's OWN spend cap apart from an empty
  // balance (Settings vs Billing), so the double has to carry that class too: `instanceof` against
  // an undefined export throws before any of this file's assertions get to run.
  class SpendCapBlocked extends Error {
    constructor(readonly detail: { requiredInternal: number; capInternal: number | null }) {
      super("Paused by your spend cap — raise it in Settings to run this.");
      this.name = "SpendCapBlocked";
    }
    get capInternal() { return this.detail.capInternal; }
  }
  const prisma = {
    entity: { findFirst: h.entityFindFirst },
    asset: { findFirst: h.assetFindFirst },
    entityVariant: { findFirst: h.variantFindFirst, create: h.variantCreate, updateMany: h.variantUpdateMany },
    referenceImage: { updateMany: h.refImageUpdateMany },
    refGenJob: {
      count: h.refGenJobCount,
      findFirst: h.refGenJobFindFirst,
      findMany: h.refGenJobFindMany,
      create: h.refGenJobCreate,
      update: h.refGenJobUpdate,
    },
    actionEvent: { create: h.actionEventCreate },
    // both shapes the actions use, with the same client standing in for the tx client. The callback
    // form also records the two facts the atomic gate depends on: that the work happened inside a
    // transaction, and that a throw carried it back out again (which is what Postgres would undo).
    $transaction: async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      h.txDepth.value += 1;
      try {
        return await (arg as (tx: unknown) => Promise<unknown>)(prisma);
      } catch (e) {
        h.rolledBack.value += 1;
        throw e;
      } finally {
        h.txDepth.value -= 1;
      }
    },
  };
  return { prisma, reserveCredits: h.reserveCredits, refundReservation: h.refundReservation, InsufficientCredits, SpendCapBlocked };
});

import { createVariant, deleteVariant, regenerateVariant } from "../refgen-actions";

const OWNER = "org-1";

/** Note one call, in order, with whether it happened inside a transaction. */
const note = (op: string) => h.trace.push({ op, inTx: h.txDepth.value > 0 });
const ops = () => h.trace.map((t) => t.op);
const noted = (op: string) => h.trace.find((t) => t.op === op);

/** Which UPDATE on the variant row this is: the CLAIM both actions take, or the tombstone itself. */
const isTombstone = (args: unknown) => (args as { data?: { deletedAt?: unknown } }).data?.deletedAt instanceof Date;

beforeEach(() => {
  vi.clearAllMocks();
  h.trace.length = 0;
  h.txDepth.value = 0;
  h.rolledBack.value = 0;
  h.requireOwner.mockResolvedValue({ ownerId: OWNER, email: "merchant@shop.test" });
  h.resolveDisabledModels.mockResolvedValue({ disabled: new Set<string>() });
  h.variantUpdateMany.mockImplementation(async (args: unknown) => {
    note(isTombstone(args) ? "variant.tombstone" : "variant.claim");
    return { count: 1 };
  });
  h.refImageUpdateMany.mockImplementation(async () => {
    note("refImage.updateMany");
    return { count: 0 };
  });
  h.refGenJobCount.mockImplementation(async () => {
    note("refGenJob.count");
    return 0;
  });
  h.refGenJobCreate.mockImplementation(async () => {
    note("refGenJob.create");
    return { id: "job-1" };
  });
  h.actionEventCreate.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// [P1] delete vs. paid work in flight
// ---------------------------------------------------------------------------
describe("deleteVariant — a variant being generated right now cannot be deleted, by anyone", () => {
  beforeEach(() => {
    // catalogKey: null ＝ 商家自己的元素。官方目录那条路(只读拒绝)由
    // official-avatar-readonly-actions.test.ts 在真库上钉,这里要的是「不是官方」这一支。
    h.variantFindFirst.mockResolvedValue({ id: "var-1", entityId: "ent-1", entity: { catalogKey: null } });
  });

  it("refuses while a paid job is QUEUED/GENERATING, and takes its own tombstone back with it", async () => {
    h.refGenJobCount.mockImplementation(async () => {
      note("refGenJob.count");
      return 1;
    });
    const res = (await deleteVariant("var-1")) as { error: string };
    expect(res.error).toContain("still being made");
    // The tombstone IS written first — that write is the lock a concurrent dispatch has to queue
    // behind — but the transaction it lives in threw, so Postgres undoes it. The cascade never ran.
    expect(h.rolledBack.value).toBe(1);
    expect(noted("variant.tombstone")?.inTx).toBe(true);
    expect(h.refImageUpdateMany).not.toHaveBeenCalled();
  });

  it("ATOMIC: the tombstone comes first and the check runs after it, in the SAME transaction", async () => {
    await deleteVariant("var-1");
    // The r2 shape was count-then-write with nothing joining them, so a paid job created in
    // between was invisible to the check and unaffected by the write. Order and transaction are
    // the whole fix: claim the row, then decide, then cascade — or roll all of it back.
    expect(ops()).toEqual(["variant.tombstone", "refGenJob.count", "refImage.updateMany"]);
    expect(h.trace.every((t) => t.inTx)).toBe(true);
    expect(h.rolledBack.value).toBe(0);
  });

  it("the check is scoped to this owner + this variant, with NO staleness window", async () => {
    await deleteVariant("var-1");
    const where = (h.refGenJobCount.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ variantId: "var-1", ownerId: OWNER, status: { in: ["QUEUED", "GENERATING"] } });
    // an abandonment window shorter than the worker's own liveness window would let a job that is
    // still genuinely running through — the exact hole this closes.
    expect(where).not.toHaveProperty("updatedAt");
  });

  it("fail-closed: if the check itself fails, the tombstone goes back too", async () => {
    h.refGenJobCount.mockRejectedValue(new Error("db unreachable"));
    const res = (await deleteVariant("var-1")) as { error: string };
    expect(res.error).toContain("nothing was deleted");
    expect(h.rolledBack.value).toBe(1);
    expect(h.refImageUpdateMany).not.toHaveBeenCalled();
  });

  it("with nothing running, the variant and its paid images go together", async () => {
    const res = await deleteVariant("var-1");
    expect(res).toEqual({ ok: true });
    expect(h.refImageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variantId: "var-1", ownerId: OWNER, deletedAt: null }) }),
    );
    expect(h.variantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "var-1", ownerId: OWNER, deletedAt: null }) }),
    );
  });

  it("a variant someone else already deleted is reported as gone, not deleted twice", async () => {
    h.variantUpdateMany.mockImplementation(async () => {
      note("variant.tombstone");
      return { count: 0 };
    });
    const res = (await deleteVariant("var-1")) as { error: string };
    expect(res.error).toBe("Variant not found.");
    expect(h.refImageUpdateMany).not.toHaveBeenCalled();
  });

  it("someone else's variant is not found — the gate is never even consulted", async () => {
    h.variantFindFirst.mockResolvedValue(null);
    const res = (await deleteVariant("var-of-another-shop")) as { error: string };
    expect(res.error).toBe("Variant not found.");
    expect(h.refGenJobCount).not.toHaveBeenCalled();
    expect(h.variantUpdateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// [P1] the other half of the same race: paid work never starts on a deleted variant
// ---------------------------------------------------------------------------
describe("regenerateVariant — the paid insert claims the variant row before it spends", () => {
  beforeEach(() => {
    h.variantFindFirst.mockResolvedValue({
      id: "var-1", entityId: "ent-1", prompt: "in a red evening gown",
      entity: { baseAssetId: "ast-base", catalogKey: null },
    });
    h.refGenJobFindFirst.mockResolvedValue(null); // nothing already in flight
    h.getBoss.mockResolvedValue({ send: vi.fn().mockResolvedValue("queue-1") });
    h.refGenJobUpdate.mockResolvedValue({});
  });

  it("ATOMIC: the claim is the first thing in the transaction, before the job and the money", async () => {
    const res = await regenerateVariant("var-1");
    expect(res).toEqual({ jobId: "job-1" });
    expect(ops()).toEqual(["variant.claim", "refGenJob.create"]);
    expect(h.trace.every((t) => t.inTx)).toBe(true);
    // the claim is an UPDATE on the LIVE row — that WHERE is what a concurrent tombstone
    // invalidates, and the write lock it takes is what makes the two actions wait for each other
    expect(h.variantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "var-1", ownerId: OWNER, deletedAt: null } }),
    );
    expect(h.reserveCredits).toHaveBeenCalled();
  });

  it("a variant tombstoned in the meantime costs nothing: no job, no reserve, and the merchant is told", async () => {
    // the claim finds no LIVE row — exactly what a delete that committed first leaves behind
    h.variantUpdateMany.mockImplementation(async () => {
      note("variant.claim");
      return { count: 0 };
    });
    const res = (await regenerateVariant("var-1")) as { error: string };
    expect(res.error).toBe("That variant was deleted while this was starting, so nothing was generated and you weren't charged.");
    expect(h.refGenJobCreate).not.toHaveBeenCalled();
    expect(h.reserveCredits).not.toHaveBeenCalled();
    expect(h.refundReservation).not.toHaveBeenCalled(); // nothing was ever held
    expect(h.rolledBack.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// [P2] a refused create leaves nothing behind
// ---------------------------------------------------------------------------
describe("createVariant — a refusal before any spend takes the empty variant with it", () => {
  beforeEach(() => {
    h.entityFindFirst.mockResolvedValue({ id: "ent-1", baseAssetId: "ast-base", catalogKey: null });
    h.assetFindFirst.mockResolvedValue({ id: "ast-base" });
    h.refGenJobFindMany.mockResolvedValue([]); // no in-flight twin to reuse
    h.refGenJobFindFirst.mockResolvedValue(null); // no active job for the new variant
    h.variantCreate.mockResolvedValue({ id: "var-new" });
  });

  const rolledBack = () =>
    h.variantUpdateMany.mock.calls.find(
      (call) =>
        (call[0] as { where?: { id?: string } }).where?.id === "var-new" &&
        (call[0] as { data?: { deletedAt?: unknown } }).data?.deletedAt instanceof Date,
    );

  it("image generation turned off: the merchant is told, and no half-made variant is left", async () => {
    h.resolveDisabledModels.mockResolvedValue({ disabled: new Set(["seedream"]) });
    const res = (await createVariant("ent-1", "Red dress", "in a red evening gown")) as { error: string };
    expect(res.error).toBe("Image generation is currently turned off.");
    expect(rolledBack()).toBeTruthy();
  });

  it("out of credits: same — and the name the merchant chose is free again for the retry", async () => {
    const { InsufficientCredits } = await import("@fikirtive/db");
    h.reserveCredits.mockRejectedValue(new InsufficientCredits("no balance"));
    const res = (await createVariant("ent-1", "Red dress", "in a red evening gown")) as { error: string };
    expect(res.error).toContain("Not enough credits");
    // soft-deleted, so the partial unique index (live rows only) frees the handle — a retry after
    // topping up is "Red dress", not "Red dress 2".
    expect(rolledBack()).toBeTruthy();
  });

  it("a job that really was queued is NEVER rolled back — the merchant paid for it", async () => {
    h.reserveCredits.mockResolvedValue(undefined);
    h.getBoss.mockResolvedValue({ send: vi.fn().mockResolvedValue("queue-1") });
    h.refGenJobUpdate.mockResolvedValue({});
    const res = await createVariant("ent-1", "Red dress", "in a red evening gown");
    expect(res).toEqual({ variantId: "var-new", jobId: "job-1" });
    expect(rolledBack()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// [P2 · r3] and when the rollback itself cannot be written, it is REPORTED
// ---------------------------------------------------------------------------
describe("createVariant — a rollback that fails is never filed as non-fatal", () => {
  /** Every soft-delete of the leftover row fails; the claim in dispatchVariantJob is not reached
   *  (this suite refuses before dispatch), so the only variant UPDATE here is the rollback. */
  function rollbackAlwaysFails() {
    h.variantUpdateMany.mockImplementation(async () => {
      note("variant.tombstone");
      throw new Error("db unreachable");
    });
  }

  beforeEach(() => {
    h.entityFindFirst.mockResolvedValue({ id: "ent-1", baseAssetId: "ast-base", catalogKey: null });
    h.assetFindFirst.mockResolvedValue({ id: "ast-base" });
    h.refGenJobFindMany.mockResolvedValue([]);
    h.refGenJobFindFirst.mockResolvedValue(null);
    h.variantCreate.mockResolvedValue({ id: "var-new" });
    h.resolveDisabledModels.mockResolvedValue({ disabled: new Set(["seedream"]) }); // refuse before spend
  });

  it("retries once — the usual cause is a blip, and a retry that works leaves nothing behind", async () => {
    let attempts = 0;
    h.variantUpdateMany.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("connection reset");
      return { count: 1 };
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = (await createVariant("ent-1", "Red dress", "in a red evening gown")) as { error: string };
    expect(res.error).toBe("Image generation is currently turned off.");
    expect(attempts).toBe(2);
    expect(errorLog).not.toHaveBeenCalled(); // it worked — nothing to report
    errorLog.mockRestore();
  });

  it("a rollback that keeps failing is logged as an ERROR naming the stranded variant", async () => {
    rollbackAlwaysFails();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await createVariant("ent-1", "Red dress", "in a red evening gown");
    const line = String(errorLog.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("ROLLBACK FAILED");
    expect(line).toContain("var-new");
    expect(line).toContain("ent-1");
    expect(line).toContain(OWNER);
    errorLog.mockRestore();
  });

  it("and recorded where a sweep can find it: an ActionEvent, which is a different row", async () => {
    rollbackAlwaysFails();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await createVariant("ent-1", "Red dress", "in a red evening gown");
    expect(h.actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: OWNER,
          type: "variant.rollback_failed",
          payload: expect.objectContaining({ entityId: "ent-1", variantId: "var-new" }),
        }),
      }),
    );
    errorLog.mockRestore();
  });

  it("the merchant still hears the ORIGINAL refusal, even when the record fails too", async () => {
    rollbackAlwaysFails();
    h.actionEventCreate.mockRejectedValue(new Error("db unreachable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = (await createVariant("ent-1", "Red dress", "in a red evening gown")) as { error: string };
    // a failed cleanup must not become a second, misleading error on top of the real one
    expect(res.error).toBe("Image generation is currently turned off.");
    expect(errorLog).toHaveBeenCalledTimes(2); // the stranded row, then the failure to record it
    errorLog.mockRestore();
  });
});
