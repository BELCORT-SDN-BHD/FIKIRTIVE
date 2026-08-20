/**
 * generateReferences — the reference-image spend gate (money-machine adjacent, W-B3-G-P / debt-68).
 *
 * The reference-generation counterpart of `generate`: an Otto tool that SPENDS real money, gated by
 * needsApproval:true (human-in-the-loop). The ONLY spend paths are the injected ports —
 * ctx.refgen.generate (a thin closure over startRefGen, the BASE/REFSHEET spend authority) and, for
 * mode=VARIANT, ctx.refgen.createVariant (#781 — the styling-variant spend authority, the same action
 * the merchant's element dialog calls). This tool NEVER:
 *   - calls the generation provider directly
 *   - reserves credits
 *   - creates a RefGenJob directly
 *
 * needsApproval is a machine-derived LITERAL `true` (cost:"spend" ⇒ deriveNeedsApproval) — never a
 * numeric predicate (which fails open). Anti-flip: the model supplies only the element + prompt +
 * bounded count/mode; the MODEL and PRICE are server-owned (startRefGen resolves the model to seedream
 * and derives the charge via pricedRefgenCredits — the caller can't set either), count is capped at 6
 * by the typed refGenRequest gate, and the owner is re-derived from the verified session (requireOwner)
 * — never from these args.
 *
 * Exactly-once: startRefGen owns the guard (one in-flight RefGenJob per entity + the partial-unique
 * RefGenJob_active_entity_variant_key backstop). The idempotencyKey below satisfies the factory's
 * "spend must declare a key" rule and documents that per-entity shape; it is NOT a second spend guard.
 */
import { z } from "zod";
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Input schema — element + prompt + bounded count/mode. NO model field (server-owned), NO identity
// (owner comes from ctx/session). Exported for tests (the built tool's .parameters is JSON Schema).
// ---------------------------------------------------------------------------
export const generateReferencesInput = z.object({
  entityId: z
    .string()
    .min(1)
    .max(64)
    .describe("The exact id of the user's saved element (character/product/location/brandmark) to generate references for — from context; never invent one."),
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .describe("What to generate — describe the look/pose/scene for the reference image(s)."),
  count: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe("How many reference images (1–6, default 1). More images cost proportionally more."),
  mode: z
    .enum(["BASE", "REFSHEET", "VARIANT"])
    .optional()
    .describe(
      "BASE = a single identity-anchor image; REFSHEET = a multi-view reference sheet (default); " +
        "VARIANT = one more look for an element that already has a base image — same person or product, " +
        "different outfit/styling. VARIANT also needs variantName.",
    ),
  variantName: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe(
      "VARIANT mode only: the short name this look is saved and re-used under (e.g. \"Red dress\", " +
        "\"Beach look\"). Required when mode is VARIANT; ignored otherwise.",
    ),
});

type GenerateReferencesInput = z.infer<typeof generateReferencesInput>;

// ---------------------------------------------------------------------------
// Execute — exported separately for direct unit-testing.
// ---------------------------------------------------------------------------
export async function executeGenerateReferences(
  input: GenerateReferencesInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ jobId: string; status: string } | { error: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // Guard — the refgen spend port MUST be injected; fail loud if absent (never a silent no-op on a
  // spend surface). Mirrors generate's `startGen port required`.
  if (!ctx.refgen) throw new Error("refgen port required");

  // VARIANT (#781) — a styling variant is a DIFFERENT spend authority (createVariant), because it
  // must create the variant row its paid image attaches to and must prove the element has a live
  // base to condition on before spending. A VARIANT ask with no name is refused HERE, before the
  // port: a nameless variant can't be saved, re-used, or asked for again by the merchant. (The
  // schema can't express "required only in this mode" without turning parameters into a ZodEffects
  // the skill factory doesn't take, so the mode pairing is checked in one place — this one.)
  const mode = input.mode;
  if (mode === "VARIANT") {
    const variantName = input.variantName?.trim();
    if (!variantName) {
      return { error: "Ask the user what to call this look (e.g. \"Red dress\"), then request it again." };
    }
    // A saved look is exactly one image (one name, one picture the user picks later). Accepting a
    // count here would let Otto promise three and deliver one — the same "said one thing, did
    // another" that a count silently clamped server-side would create. Refuse instead.
    if (input.count !== undefined && input.count !== 1) {
      return { error: "Each look is one image. Ask for one look at a time — a second outfit is a second look, with its own name." };
    }
    const created = await ctx.refgen.createVariant({
      entityId: input.entityId,
      name: variantName,
      prompt: input.prompt,
    });
    if ("error" in created) return created;
    return { jobId: created.jobId, status: "queued" };
  }

  // The ONLY spend path for BASE/REFSHEET — forward to startRefGen via the port. It owner-scopes the
  // element (requireOwner + owned-entity lookup → "Element not found." for a forged/cross-tenant id),
  // re-validates through refGenRequest, server-derives the price, and reserves atomically.
  const res = await ctx.refgen.generate({
    entityId: input.entityId,
    prompt: input.prompt,
    count: input.count,
    mode,
  });
  if ("error" in res) return res;
  return { jobId: res.id, status: "queued" };
}

// ---------------------------------------------------------------------------
// Skill definition via factory — derives needsApproval from cost:"spend" (LITERAL true).
// ---------------------------------------------------------------------------
export const generateReferencesSkill = defineOttoSkill({
  name: "generateReferences",
  cost: "spend",
  effect: "write",
  reach: "internal",
  // The real exactly-once guard lives in the authority the call lands on: startRefGen (per-entity
  // in-flight check + the partial-unique index) for BASE/REFSHEET, createVariant (same-name/same-prompt
  // in-flight dedup + the per-variant active-job guard) for VARIANT — hence the name in the VARIANT
  // key, since two different looks on one element are two legitimate jobs. This declaration satisfies
  // the factory's "spend must declare an idempotencyKey" rule and documents that shape — it is NOT a
  // second spend guard.
  idempotencyKey: (i) => (i.mode === "VARIANT" ? `refgen:${i.entityId}:${i.variantName ?? ""}` : `refgen:${i.entityId}`),
  description:
    "Generate reference images for one of the user's saved elements (a character, product, location, " +
    "or brandmark). This SPENDS the user's credits and REQUIRES the user's approval — only call it when " +
    "the user has clearly asked to generate references for that specific element. Pass the element's id " +
    "(entityId) and a prompt describing what to generate; count is 1–6 (default 1). The model and price " +
    "are fixed by the server, not this call. One generation runs per element at a time. " +
    "Use mode VARIANT with a variantName to add another look to an element that already has a base image " +
    "— the same person or product restyled (a different outfit, colourway or setting), saved under that " +
    "name so the user can ask for it later; one VARIANT call makes exactly one image.",
  parameters: generateReferencesInput,
  execute: executeGenerateReferences,
});
