/**
 * manageBrandMemory — $0 brand-memory lifecycle skill (W-B3-D, parity debts 31/32/51 / E1-11,E1-12).
 *
 * The delete/restore half of brand memory that the existing $0 write skills can't do:
 *  - saveProduct / rememberBrandFact ADD or update records/facts, but cannot REMOVE one.
 *  - lookupProducts READS them.
 * This skill soft-deletes a living-collection record (product/segment/offer), restores one Otto
 * removed, or soft-deletes a brand fact/memory — the SAME operations the human Brand memory UI does.
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected `ctx.brandMemory`
 * port — thin closures over the SAME owner-gated server actions the human UI uses
 * (brand-record-actions.deleteBrandRecord / restoreBrandRecord, memory-actions.deleteMemory). This
 * skill never touches Prisma or the web action files directly (CI fence rule).
 *
 * $0 by construction: no GenJob, no credits, no provider. All deletes are SOFT (deletedAt tombstone);
 * records also have an undo (restore_record). A fact/memory delete has no undo skill — say so plainly.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

const params = z.object({
  action: z.enum(["delete_record", "restore_record", "delete_fact"]),
  id: z
    .string()
    .min(1)
    .max(80)
    .describe("The brand-memory id: a product/segment/offer record (delete_record / restore_record) or a brand fact (delete_fact)."),
});

type ManageBrandMemoryInput = z.infer<typeof params>;

export async function executeManageBrandMemory(
  input: ManageBrandMemoryInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const brandMemory = ctx.brandMemory;
  if (!brandMemory) return { ok: false, error: "Brand memory isn't available right now." };

  switch (input.action) {
    case "delete_record": {
      const r = await brandMemory.deleteRecord(input.id);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "restore_record": {
      const r = await brandMemory.restoreRecord(input.id);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "delete_fact": {
      const r = await brandMemory.deleteFact(input.id);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
  }
}

export const manageBrandMemorySkill = defineOttoSkill({
  name: "manageBrandMemory",
  // $0 brand-memory lifecycle: soft-deletes/restores OUR records/facts only. free + write + internal
  // ⇒ needsApproval=false — same as the human Brand memory UI. Deletes are reversible (soft).
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Remove or restore brand memory — $0, never generates or spends. " +
    "delete_record: remove a product/segment/offer from the living collections (soft — reversible with restore_record). " +
    "restore_record: bring a removed record back. " +
    "delete_fact: remove a saved brand fact/memory (soft; there's no restore for facts — tell the user it can't be undone from here). " +
    "To ADD or update products/facts, use saveProduct / rememberBrandFact instead.",
  parameters: params,
  execute: executeManageBrandMemory,
});
