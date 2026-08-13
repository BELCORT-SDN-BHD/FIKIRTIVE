import { describe, it, expect, vi, beforeEach } from "vitest";

// W-B3-G-P (debt-68/69): the ctx.refgen port wraps the SAME owner-gated refgen server actions the human
// element UI uses. generate forwards to startRefGen — the SOLE spend authority (own requireOwner +
// refGenRequest gate + server-priced reserve). deleteVariant carries a fail-closed active-job pre-gate:
// any paid RefGenJob still in flight for that variant ⇒ deterministic refusal (the running job would
// settle onto a tombstoned variant, wasting spend); fail-closed on a failing count read.
//
// #781 r2/r3 CORRECTION — this pre-gate is no longer the rule, only Otto's WORDING of it. The rule
// itself moved into deleteVariant, where every caller meets it (the merchant's own Delete button
// called the action directly and used to pass straight through), and r3 made it atomic with the
// delete. What is asserted below is that Otto refuses in its own words BEFORE delegating; the action
// underneath refuses again regardless, so a port that ever drifted would still not lose paid work.

const { mockRefGenJobCount, mockStartRefGen, mockCreateVariant, mockDeleteVariant } = vi.hoisted(() => ({
  mockRefGenJobCount: vi.fn(),
  mockStartRefGen: vi.fn(),
  mockCreateVariant: vi.fn(),
  mockDeleteVariant: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    refGenJob: { count: mockRefGenJobCount },
  },
}));
vi.mock("../refgen-actions", () => ({
  startRefGen: mockStartRefGen,
  createVariant: mockCreateVariant,
  deleteVariant: mockDeleteVariant,
}));

import { makeOttoRefgenPort } from "../otto-refgen-port";

const port = () => makeOttoRefgenPort("owner-1");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generate — forwards to the sole spend authority (startRefGen)", () => {
  it("passes the bounded request through and returns the job id", async () => {
    mockStartRefGen.mockResolvedValue({ id: "refjob-1" });
    const res = await port().generate({ entityId: "ent-1", prompt: "a red cap", count: 3, mode: "REFSHEET" });
    expect(res).toEqual({ id: "refjob-1" });
    expect(mockStartRefGen).toHaveBeenCalledTimes(1);
    expect(mockStartRefGen).toHaveBeenCalledWith({
      entityId: "ent-1",
      prompt: "a red cap",
      count: 3,
      mode: "REFSHEET",
    });
  });

  it("defaults count→1 and mode→REFSHEET when omitted (never sends a malformed request)", async () => {
    mockStartRefGen.mockResolvedValue({ id: "refjob-2" });
    await port().generate({ entityId: "ent-2", prompt: "just this" });
    expect(mockStartRefGen).toHaveBeenCalledWith({
      entityId: "ent-2",
      prompt: "just this",
      count: 1,
      mode: "REFSHEET",
    });
  });

  it("surfaces the authority's structured error verbatim (owner-scope reject), no id", async () => {
    mockStartRefGen.mockResolvedValue({ error: "Element not found." });
    const res = await port().generate({ entityId: "ent-OTHER", prompt: "x" });
    expect(res).toEqual({ error: "Element not found." });
  });

  it("never sends a client-supplied model/price — only the four typed fields cross", async () => {
    mockStartRefGen.mockResolvedValue({ id: "refjob-3" });
    // Even if a caller object carried extra keys via `as any`, the port only forwards the 4 named fields.
    await port().generate({ entityId: "ent-3", prompt: "p", count: 2 } as never);
    const arg = mockStartRefGen.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(["count", "entityId", "mode", "prompt"]);
    expect(arg["model"]).toBeUndefined();
    expect(arg["price"]).toBeUndefined();
  });
});

// #781 — the styling-variant door. createVariant is the variant SPEND authority (startRefGen refuses
// mode=VARIANT because a client-named variantId is unvalidated); the port only forwards the three
// merchant-chosen fields, so Otto and the element dialog charge by exactly one rule.
describe("createVariant — forwards to the variant spend authority (createVariant action)", () => {
  it("passes element + name + change through and returns the variant and job ids", async () => {
    mockCreateVariant.mockResolvedValue({ variantId: "var-1", jobId: "refjob-v1" });
    const res = await port().createVariant({ entityId: "ent-1", name: "Red dress", prompt: "in a red evening gown" });
    expect(res).toEqual({ variantId: "var-1", jobId: "refjob-v1" });
    expect(mockCreateVariant).toHaveBeenCalledTimes(1);
    expect(mockCreateVariant).toHaveBeenCalledWith("ent-1", "Red dress", "in a red evening gown");
  });

  it("never reaches startRefGen — a variant is NOT a second refgen spend path bolted onto the first", async () => {
    mockCreateVariant.mockResolvedValue({ variantId: "var-2", jobId: "refjob-v2" });
    await port().createVariant({ entityId: "ent-2", name: "Beach look", prompt: "on a beach at golden hour" });
    expect(mockStartRefGen).not.toHaveBeenCalled();
  });

  it("no model, count or price ever crosses — only the three merchant-chosen fields", async () => {
    mockCreateVariant.mockResolvedValue({ variantId: "var-3", jobId: "refjob-v3" });
    await port().createVariant({ entityId: "ent-3", name: "Gold lid", prompt: "the tin with a gold lid", model: "expensive", count: 6 } as never);
    expect(mockCreateVariant).toHaveBeenCalledWith("ent-3", "Gold lid", "the tin with a gold lid");
    expect(mockCreateVariant.mock.calls[0]).toHaveLength(3);
  });

  it("surfaces the authority's refusals verbatim (no base yet / cross-tenant element)", async () => {
    mockCreateVariant.mockResolvedValue({ error: "Set a base identity first — variants are generated from it." });
    expect(await port().createVariant({ entityId: "ent-4", name: "X", prompt: "y" })).toEqual({
      error: "Set a base identity first — variants are generated from it.",
    });
    mockCreateVariant.mockResolvedValue({ error: "Element not found." });
    expect(await port().createVariant({ entityId: "ent-OTHER", name: "X", prompt: "y" })).toEqual({
      error: "Element not found.",
    });
  });
});

describe("deleteVariant — active-job hard gate (deterministic, fail-closed, no model self-confirmation)", () => {
  it("a variant with a paid job STILL IN FLIGHT is refused and never reaches deleteVariant", async () => {
    mockRefGenJobCount.mockResolvedValue(1);
    const res = (await port().deleteVariant("var-running")) as { error: string };
    expect(res.error).toContain("still has a reference generation running");
    expect(res.error).toContain("paid work");
    expect(mockDeleteVariant).not.toHaveBeenCalled();
  });

  it("the active-job read is scoped owner + variant + active status window", async () => {
    mockRefGenJobCount.mockResolvedValue(0);
    mockDeleteVariant.mockResolvedValue({ ok: true });
    await port().deleteVariant("var-scope");
    expect(mockRefGenJobCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variantId: "var-scope",
          ownerId: "owner-1",
          status: { in: ["QUEUED", "GENERATING"] },
        }),
      }),
    );
  });

  it("no active job (count 0) passes through to the guarded owner-scoped deleteVariant", async () => {
    mockRefGenJobCount.mockResolvedValue(0);
    mockDeleteVariant.mockResolvedValue({ ok: true });
    const res = await port().deleteVariant("var-idle");
    expect(res).toEqual({ ok: true });
    expect(mockDeleteVariant).toHaveBeenCalledWith("var-idle");
  });

  it("fail-closed: a failing count read REFUSES the delete (never 'couldn't check, delete anyway')", async () => {
    mockRefGenJobCount.mockRejectedValue(new Error("db down"));
    const res = (await port().deleteVariant("var-any")) as { error: string };
    expect(res.error).toContain("won't remove it");
    expect(mockDeleteVariant).not.toHaveBeenCalled();
  });

  it("surfaces the action's not-found verbatim once the gate passes", async () => {
    mockRefGenJobCount.mockResolvedValue(0);
    mockDeleteVariant.mockResolvedValue({ error: "Variant not found." });
    const res = (await port().deleteVariant("var-forged")) as { error: string };
    expect(res.error).toBe("Variant not found.");
  });

  // debt-69 refit (PR #279 P1): the 15min abandonment window is GONE. It was shorter than the
  // worker's own liveness window (REFGEN_STALE_MS 18min / queue expiry ~20min / reaper 25min), so a
  // 15-18min-old job that was still genuinely alive got misjudged abandoned and let through — the job
  // then settled onto the tombstoned variant (spend charged, product unreachable). Now ANY live job
  // hard-refuses regardless of age; a truly stuck job is released only by the 25min reaper (→ FAILED).
  it("has NO staleness window: the active-job count query is never narrowed by updatedAt", async () => {
    mockRefGenJobCount.mockResolvedValue(0);
    mockDeleteVariant.mockResolvedValue({ ok: true });
    await port().deleteVariant("var-window");
    const where = (mockRefGenJobCount.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty("updatedAt");
    expect(where.status).toEqual({ in: ["QUEUED", "GENERATING"] });
  });

  it("a super-aged active job (older than the worker's 18min liveness window) is STILL refused — no window lets it through", async () => {
    // No updatedAt filter ⇒ an ancient-but-alive QUEUED/GENERATING job still counts and blocks the delete.
    mockRefGenJobCount.mockResolvedValue(1);
    const res = (await port().deleteVariant("var-old-but-live")) as { error: string };
    expect(res.error).toContain("still has a reference generation running");
    expect(mockDeleteVariant).not.toHaveBeenCalled();
  });
});
