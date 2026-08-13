/**
 * deleteReferenceVariant — $0 guarded reference-variant delete (W-B3-G-P / debt-69).
 *
 * Lets Otto delete one of an element's reference variants the SAME way the human element UI does, through
 * the injected `ctx.refgen.deleteVariant` port — a thin closure over the SAME owner-gated deleteVariant
 * server action (requireOwner; "Variant not found." fail-closes a forged/cross-tenant id). This skill
 * never touches Prisma, the provider, or web action files directly (CI fence rule).
 *
 * $0, but destructive: deleteVariant soft-deletes the variant AND its tagged reference images (paid
 * outputs). A deterministic, fail-closed active-job gate refuses while a paid RefGenJob for that variant
 * is still in flight, so a delete can't strand settling paid work — enforced by the deleteVariant action
 * for every caller (#781 r2: the merchant's element page is refused on the same terms) and re-stated in
 * Otto's words by the port (makeOttoRefgenPort, the #271 deleteProject precedent). That refusal surfaces
 * here verbatim; there is no override parameter. The
 * model must ALSO never invent an id — owner scope + not-found fail closed on a fabricated variantId.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

const params = z.object({
  variantId: z
    .string()
    .min(1)
    .max(64)
    .describe("The EXACT id of the reference variant to delete (from context) — delete REQUIRES it; never guess."),
});

type DeleteReferenceVariantInput = z.infer<typeof params>;

export async function executeDeleteReferenceVariant(
  input: DeleteReferenceVariantInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const refgen = ctx.refgen;
  // $0 surface — degrade gracefully when the port isn't injected (e.g. the minimal worker verdict ctx).
  if (!refgen) return { ok: false, error: "Reference-variant management isn't available right now." };

  const r = await refgen.deleteVariant(input.variantId);
  return "error" in r ? { ok: false, error: r.error } : { ok: true };
}

export const deleteReferenceVariantSkill = defineOttoSkill({
  name: "deleteReferenceVariant",
  // $0 soft delete of OUR rows only (never credits, never the provider). free + write + internal ⇒
  // needsApproval=false. The protection is the guarded owner-scoped action + the port's active-job gate.
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Delete one of an element's reference variants (and its generated reference images) — $0, never " +
    "generates or spends. Only when the user clearly asks to remove that specific variant. Pass the EXACT " +
    "variantId (from context) — never guess which one; it can't be undone from here. A variant that still " +
    "has a reference generation running is refused — wait for it to finish first.",
  parameters: params,
  execute: executeDeleteReferenceVariant,
});

export const deleteReferenceVariant = deleteReferenceVariantSkill.tool;
