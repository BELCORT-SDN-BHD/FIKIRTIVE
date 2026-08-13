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
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
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
    // both shapes the actions use: the array form (deleteVariant's cascade) and the callback form
    // (the reserve-with-insert), with the same client standing in for the tx client.
    $transaction: async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };
  return { prisma, reserveCredits: h.reserveCredits, refundReservation: h.refundReservation, InsufficientCredits };
});

import { createVariant, deleteVariant } from "../refgen-actions";

const OWNER = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOwner.mockResolvedValue({ ownerId: OWNER, email: "merchant@shop.test" });
  h.resolveDisabledModels.mockResolvedValue({ disabled: new Set<string>() });
  h.variantUpdateMany.mockResolvedValue({ count: 1 });
  h.refImageUpdateMany.mockResolvedValue({ count: 0 });
  h.actionEventCreate.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// [P1] delete vs. paid work in flight
// ---------------------------------------------------------------------------
describe("deleteVariant — a variant being generated right now cannot be deleted, by anyone", () => {
  beforeEach(() => {
    h.variantFindFirst.mockResolvedValue({ id: "var-1", entityId: "ent-1" });
  });

  it("refuses while a paid job is QUEUED/GENERATING, and deletes nothing", async () => {
    h.refGenJobCount.mockResolvedValue(1);
    const res = (await deleteVariant("var-1")) as { error: string };
    expect(res.error).toContain("still being made");
    // the whole point: no tombstone for the running job to land on
    expect(h.variantUpdateMany).not.toHaveBeenCalled();
    expect(h.refImageUpdateMany).not.toHaveBeenCalled();
  });

  it("the check is scoped to this owner + this variant, with NO staleness window", async () => {
    h.refGenJobCount.mockResolvedValue(0);
    await deleteVariant("var-1");
    const where = (h.refGenJobCount.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ variantId: "var-1", ownerId: OWNER, status: { in: ["QUEUED", "GENERATING"] } });
    // an abandonment window shorter than the worker's own liveness window would let a job that is
    // still genuinely running through — the exact hole this closes.
    expect(where).not.toHaveProperty("updatedAt");
  });

  it("fail-closed: if the check itself fails, nothing is deleted", async () => {
    h.refGenJobCount.mockRejectedValue(new Error("db unreachable"));
    const res = (await deleteVariant("var-1")) as { error: string };
    expect(res.error).toContain("nothing was deleted");
    expect(h.variantUpdateMany).not.toHaveBeenCalled();
  });

  it("with nothing running, the variant and its paid images go together", async () => {
    h.refGenJobCount.mockResolvedValue(0);
    const res = await deleteVariant("var-1");
    expect(res).toEqual({ ok: true });
    expect(h.refImageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variantId: "var-1", ownerId: OWNER, deletedAt: null }) }),
    );
    expect(h.variantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "var-1", ownerId: OWNER }) }),
    );
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
// [P2] a refused create leaves nothing behind
// ---------------------------------------------------------------------------
describe("createVariant — a refusal before any spend takes the empty variant with it", () => {
  beforeEach(() => {
    h.entityFindFirst.mockResolvedValue({ id: "ent-1", baseAssetId: "ast-base" });
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
    h.refGenJobCreate.mockResolvedValue({ id: "job-1" });
    h.reserveCredits.mockRejectedValue(new InsufficientCredits("no balance"));
    const res = (await createVariant("ent-1", "Red dress", "in a red evening gown")) as { error: string };
    expect(res.error).toContain("Not enough credits");
    // soft-deleted, so the partial unique index (live rows only) frees the handle — a retry after
    // topping up is "Red dress", not "Red dress 2".
    expect(rolledBack()).toBeTruthy();
  });

  it("a job that really was queued is NEVER rolled back — the merchant paid for it", async () => {
    h.refGenJobCreate.mockResolvedValue({ id: "job-1" });
    h.reserveCredits.mockResolvedValue(undefined);
    h.getBoss.mockResolvedValue({ send: vi.fn().mockResolvedValue("queue-1") });
    h.refGenJobUpdate.mockResolvedValue({});
    const res = await createVariant("ent-1", "Red dress", "in a red evening gown");
    expect(res).toEqual({ variantId: "var-new", jobId: "job-1" });
    expect(rolledBack()).toBeUndefined();
  });
});
