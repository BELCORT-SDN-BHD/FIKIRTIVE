/**
 * generate-references.test.ts — money-machine tests for the generateReferences spend skill (debt-68).
 *
 * The skill's ONLY spend path is the injected ctx.refgen.generate port (a thin closure over
 * startRefGen). No @fikirtive/db mock is needed — the skill never touches Prisma. Every money-safety
 * property is asserted independently, MockProvider-style (a vi.fn() port, zero real provider calls,
 * zero real spend).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateReferences,
  generateReferencesInput,
  executeGenerateReferences,
} from "./generate-references.js";
import type { OttoContext } from "../context.js";

const ENTITY_ID = "ent-abc123";
const ORG_ID = "org-test";

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: ORG_ID,
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    refgen: {
      generate: vi.fn().mockResolvedValue({ id: "refjob-new" }),
      createVariant: vi.fn().mockResolvedValue({ variantId: "var-new", jobId: "refjob-variant" }),
      deleteVariant: vi.fn().mockResolvedValue({ ok: true }),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — needsApproval is the LITERAL `true` (anti-flip; cannot be flipped false by any arg/flag).
// ---------------------------------------------------------------------------
describe("Test 1 — needsApproval resolves to literal true (anti-flip)", () => {
  it("generateReferences.needsApproval() resolves to true", async () => {
    const result = await (generateReferences.needsApproval as () => Promise<boolean>)();
    expect(result).toBe(true);
    expect(generateReferences.needsApproval).toBeTruthy();
  });

  it("no argument/flag can flip it to false", async () => {
    // The SDK normalizes boolean true to an async () => true — it takes no input, so a malicious
    // arg can't turn approval off. Call it with junk and confirm it still resolves true.
    const fn = generateReferences.needsApproval as (x?: unknown) => Promise<boolean>;
    expect(await fn({ skipApproval: true })).toBe(true);
    expect(await fn(false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — input schema: element + prompt + bounded count/mode; identity/model/price stripped.
// ---------------------------------------------------------------------------
describe("Test 2 — input schema is bounded; server-owned fields stripped", () => {
  it("strips unknown fields (model, price, ownerId) from parsed input", () => {
    const raw = { entityId: ENTITY_ID, prompt: "a red cap", model: "gpt-5", price: 1, ownerId: "org-EVIL" };
    const parsed = generateReferencesInput.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>;
      expect(data["entityId"]).toBe(ENTITY_ID);
      expect(data["prompt"]).toBe("a red cap");
      expect(data["model"]).toBeUndefined();
      expect(data["price"]).toBeUndefined();
      expect(data["ownerId"]).toBeUndefined();
    }
  });

  it("rejects missing entityId / empty prompt", () => {
    expect(generateReferencesInput.safeParse({ prompt: "x" }).success).toBe(false);
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "" }).success).toBe(false);
  });

  it("caps count at 6 (the typed gate bound); rejects count 99 and count 0", () => {
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "x", count: 99 }).success).toBe(false);
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "x", count: 0 }).success).toBe(false);
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "x", count: 4 }).success).toBe(true);
  });

  // #781 opened VARIANT (it now routes to the createVariant authority — see Test 7). The set is
  // still CLOSED: anything outside the three named modes is rejected by the typed gate.
  it("rejects an out-of-set mode; the three real modes parse", () => {
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "x", mode: "FREESTYLE" }).success).toBe(false);
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "x", mode: "REFSHEET" }).success).toBe(true);
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "x", mode: "BASE" }).success).toBe(true);
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "x", mode: "VARIANT" }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — the port (the SOLE spend authority) receives exactly the bounded request; nothing else.
// ---------------------------------------------------------------------------
describe("Test 3 — forwards only the bounded request to the sole spend authority", () => {
  it("ctx.refgen.generate is called once with {entityId, prompt, count, mode} — no model/price", async () => {
    const ctx = makeCtx();
    const res = await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "a red cap", count: 3, mode: "REFSHEET" },
      { context: ctx },
    );
    expect(res).toEqual({ jobId: "refjob-new", status: "queued" });
    const gen = ctx.refgen!.generate as ReturnType<typeof vi.fn>;
    expect(gen).toHaveBeenCalledTimes(1);
    const arg = gen.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toEqual({ entityId: ENTITY_ID, prompt: "a red cap", count: 3, mode: "REFSHEET" });
    // price / model are NOT the skill's to set — they must be absent from the forwarded request.
    expect(arg["model"]).toBeUndefined();
    expect(arg["price"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — owner isolation / structured hard-reject: a cross-tenant/forged element is refused,
// no job returned, surfaced verbatim from the authority.
// ---------------------------------------------------------------------------
describe("Test 4 — owner isolation surfaces the authority's structured hard-reject", () => {
  it("port returns {error:'Element not found.'} (owner-scope reject) → skill returns the error, no jobId", async () => {
    const ctx = makeCtx();
    (ctx.refgen!.generate as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "Element not found." });
    const res = await executeGenerateReferences(
      { entityId: "ent-OTHER-owner", prompt: "x" },
      { context: ctx },
    );
    expect(res).toEqual({ error: "Element not found." });
    expect(res).not.toHaveProperty("jobId");
  });
});

// ---------------------------------------------------------------------------
// Test 5 — missing spend port throws (fail loud, never a silent no-op).
// ---------------------------------------------------------------------------
describe("Test 5 — missing refgen port throws", () => {
  it("ctx.refgen undefined → throws 'refgen port required'", async () => {
    const ctx = makeCtx({ refgen: undefined });
    await expect(
      executeGenerateReferences({ entityId: ENTITY_ID, prompt: "x" }, { context: ctx }),
    ).rejects.toThrow("refgen port required");
  });
});

// ---------------------------------------------------------------------------
// Test 6 — import audit: generate-references.ts does NOT bypass the port / touch spend primitives.
// ---------------------------------------------------------------------------
describe("Test 6 — import audit: no direct spend bypass", () => {
  it("source does not import the provider, create a RefGenJob, reserve credits, or import web actions", () => {
    const src = readFileSync(new URL("./generate-references.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+['"]@fikirtive\/generation['"]/);
    expect(src).not.toMatch(/refGenJob\.create/);
    expect(src).not.toMatch(/reserveCredits\s*\(/);
    expect(src).not.toMatch(/from\s+['"][^'"]*apps\//);
    expect(src).not.toMatch(/from\s+['"][^'"]*refgen-actions/);
    // The ONLY spend path is the injected port.
    expect(src).toMatch(/ctx\.refgen/);
  });
});

// ---------------------------------------------------------------------------
// Test 7 (#781) — the VARIANT door: "one element, several outfits".
//
// A styling variant is a DIFFERENT spend authority (createVariant): it must create the variant row
// the paid image attaches to and prove the element has a live base to condition on. These tests pin
// that the skill routes there and NEVER to startRefGen (which refuses mode=VARIANT on purpose), and
// that a nameless variant is refused before any spend.
// ---------------------------------------------------------------------------
describe("Test 7 — mode VARIANT routes to the variant spend authority, never to startRefGen", () => {
  it("VARIANT + variantName → ctx.refgen.createVariant with the element, name and change", async () => {
    const ctx = makeCtx();
    const res = await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "wearing an elegant red evening gown", mode: "VARIANT", variantName: "Red dress" },
      { context: ctx },
    );
    expect(res).toEqual({ jobId: "refjob-variant", status: "queued" });
    expect(ctx.refgen!.createVariant).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      name: "Red dress",
      prompt: "wearing an elegant red evening gown",
    });
    // the BASE/REFSHEET authority is not a variant authority — it must not be reached
    expect(ctx.refgen!.generate).not.toHaveBeenCalled();
  });

  it("VARIANT with a blank/absent name is refused BEFORE the port — nothing is created, nothing is spent", async () => {
    const ctx = makeCtx();
    const missing = await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "a red gown", mode: "VARIANT" },
      { context: ctx },
    );
    expect(missing).toHaveProperty("error");
    const blank = await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "a red gown", mode: "VARIANT", variantName: "   " },
      { context: ctx },
    );
    expect(blank).toHaveProperty("error");
    expect(ctx.refgen!.createVariant).not.toHaveBeenCalled();
    expect(ctx.refgen!.generate).not.toHaveBeenCalled();
  });

  it("the variant name is trimmed before it becomes the saved look's name", async () => {
    const ctx = makeCtx();
    await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "on a beach", mode: "VARIANT", variantName: "  Beach look  " },
      { context: ctx },
    );
    expect(ctx.refgen!.createVariant).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Beach look" }),
    );
  });

  it("BASE and REFSHEET are untouched — they still go to startRefGen, and variantName never rides along", async () => {
    const ctx = makeCtx();
    await executeGenerateReferences({ entityId: ENTITY_ID, prompt: "p", mode: "BASE", variantName: "ignored" }, { context: ctx });
    expect(ctx.refgen!.createVariant).not.toHaveBeenCalled();
    const arg = (ctx.refgen!.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(arg["mode"]).toBe("BASE");
    expect(arg).not.toHaveProperty("variantName");
  });

  it("the authority's refusal (no base yet) reaches the user verbatim, with no jobId", async () => {
    const ctx = makeCtx();
    (ctx.refgen!.createVariant as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "Set a base identity first — variants are generated from it.",
    });
    const res = await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "a red gown", mode: "VARIANT", variantName: "Red dress" },
      { context: ctx },
    );
    expect(res).toEqual({ error: "Set a base identity first — variants are generated from it." });
    expect(res).not.toHaveProperty("jobId");
  });

  it("VARIANT is still an approval-gated spend: the schema accepts it and needsApproval stays literal true", async () => {
    expect(generateReferencesInput.safeParse({ entityId: ENTITY_ID, prompt: "p", mode: "VARIANT", variantName: "Red dress" }).success).toBe(true);
    expect(await (generateReferences.needsApproval as () => Promise<boolean>)()).toBe(true);
  });
});

// A count on a VARIANT ask is refused rather than silently clamped to 1: a clamp would let Otto
// promise three looks and deliver one, which is the exact "said one thing, did another" this repo
// keeps paying for.
describe("Test 8 — a look is one image, and Otto is told so rather than quietly given one", () => {
  it("VARIANT with count > 1 is refused before any spend", async () => {
    const ctx = makeCtx();
    const res = await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "a red gown", mode: "VARIANT", variantName: "Red dress", count: 3 },
      { context: ctx },
    );
    expect(res).toHaveProperty("error");
    expect(ctx.refgen!.createVariant).not.toHaveBeenCalled();
  });

  it("VARIANT with an explicit count of 1 is fine (it is what a look already is)", async () => {
    const ctx = makeCtx();
    const res = await executeGenerateReferences(
      { entityId: ENTITY_ID, prompt: "a red gown", mode: "VARIANT", variantName: "Red dress", count: 1 },
      { context: ctx },
    );
    expect(res).toEqual({ jobId: "refjob-variant", status: "queued" });
  });
});
