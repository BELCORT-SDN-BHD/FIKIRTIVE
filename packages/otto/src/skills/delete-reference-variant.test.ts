/**
 * delete-reference-variant.test.ts — the guarded $0 reference-variant delete skill (debt-69).
 *
 * The skill delegates to the injected ctx.refgen.deleteVariant port (a thin closure over the
 * owner-scoped deleteVariant action, fronted by the port's fail-closed active-job gate). No Prisma
 * mock is needed — the skill never touches the DB; the port's fail-closed refusal is surfaced verbatim.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  deleteReferenceVariant,
  executeDeleteReferenceVariant,
} from "./delete-reference-variant.js";
import type { OttoContext } from "../context.js";

const VARIANT_ID = "var-abc123";

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    refgen: {
      generate: vi.fn().mockResolvedValue({ id: "refjob-x" }),
      deleteVariant: vi.fn().mockResolvedValue({ ok: true }),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — this is a $0 skill: needsApproval is false (no spend, no human gate).
// ---------------------------------------------------------------------------
describe("Test 1 — $0 skill, needsApproval false", () => {
  it("deleteReferenceVariant.needsApproval() resolves to false", async () => {
    const result = await (deleteReferenceVariant.needsApproval as () => Promise<boolean>)();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — delegates to the same owner-scoped authority via the port.
// ---------------------------------------------------------------------------
describe("Test 2 — delegates to ctx.refgen.deleteVariant", () => {
  it("passes the exact variantId and returns {ok:true} on success", async () => {
    const ctx = makeCtx();
    const res = await executeDeleteReferenceVariant({ variantId: VARIANT_ID }, { context: ctx });
    expect(res).toEqual({ ok: true });
    const del = ctx.refgen!.deleteVariant as ReturnType<typeof vi.fn>;
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(VARIANT_ID);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — fail-closed refusal surfaced verbatim (active-job gate / not-found), no override.
// ---------------------------------------------------------------------------
describe("Test 3 — port refusal surfaced verbatim (fail-closed)", () => {
  it("active-job refusal from the port → skill returns {ok:false, error}", async () => {
    const ctx = makeCtx();
    (ctx.refgen!.deleteVariant as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "That variant still has a reference generation running — wait for it to finish (or cancel it) before deleting, so paid work isn't wasted.",
    });
    const res = (await executeDeleteReferenceVariant({ variantId: VARIANT_ID }, { context: ctx })) as {
      ok: false;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("still has a reference generation running");
  });

  it("owner-scope not-found from the action → skill returns {ok:false, error}", async () => {
    const ctx = makeCtx();
    (ctx.refgen!.deleteVariant as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "Variant not found." });
    const res = (await executeDeleteReferenceVariant({ variantId: "var-FORGED" }, { context: ctx })) as {
      ok: false;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Variant not found.");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — missing port degrades gracefully ($0 surface — no throw).
// ---------------------------------------------------------------------------
describe("Test 4 — missing refgen port degrades gracefully", () => {
  it("ctx.refgen undefined → {ok:false, error}, never throws, never a phantom success", async () => {
    const ctx = makeCtx({ refgen: undefined });
    const res = (await executeDeleteReferenceVariant({ variantId: VARIANT_ID }, { context: ctx })) as {
      ok: false;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Test 5 — import audit: never touches the DB / provider / web actions directly.
// ---------------------------------------------------------------------------
describe("Test 5 — import audit", () => {
  it("source uses only the injected port; no Prisma / provider / web-action import", () => {
    const src = readFileSync(new URL("./delete-reference-variant.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+['"]@fikirtive\/db['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*apps\//);
    expect(src).not.toMatch(/from\s+['"][^'"]*refgen-actions/);
    expect(src).toMatch(/ctx\.refgen/);
  });
});
