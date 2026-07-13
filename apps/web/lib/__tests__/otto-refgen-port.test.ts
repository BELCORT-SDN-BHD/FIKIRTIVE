import { describe, it, expect, vi, beforeEach } from "vitest";

// W-B3-G-P (debt-68/69): the ctx.refgen port wraps the SAME owner-gated refgen server actions the human
// element UI uses. generate forwards to startRefGen — the SOLE spend authority (own requireOwner +
// refGenRequest gate + server-priced reserve). deleteVariant carries an Otto-only fail-closed active-job
// gate: any paid RefGenJob still in flight for that variant ⇒ deterministic refusal (the running job
// would settle onto a tombstoned variant, wasting spend); fail-closed on a failing count read. The gate
// lives in the port, NOT in deleteVariant — the human UI's legitimate delete is untouched (#271 precedent).

const { mockRefGenJobCount, mockStartRefGen, mockDeleteVariant } = vi.hoisted(() => ({
  mockRefGenJobCount: vi.fn(),
  mockStartRefGen: vi.fn(),
  mockDeleteVariant: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    refGenJob: { count: mockRefGenJobCount },
  },
}));
vi.mock("../refgen-actions", () => ({
  startRefGen: mockStartRefGen,
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
});
