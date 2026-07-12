/**
 * manageEntities — $0 element skill (W-B3-D, parity debts 08-10 / B0-11).
 *
 * Lets Otto manage the owner's reusable elements (the @-referenceable characters, locations,
 * products, brandmarks) the SAME way the human elements UI does: create a named element, remove an
 * element, or remove one of an element's reference photos.
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected `ctx.entities`
 * port — thin closures over the SAME owner-gated server actions the human UI uses (actions.ts:
 * createEntity / softDeleteEntity / softDeleteReferenceImage). This skill never touches Prisma or the
 * web action files directly (CI fence rule).
 *
 * Honest parity boundary: `create` makes a NAMED element WITHOUT reference photos. Uploading photos
 * is a human file-picker action (the model has no files to upload) — so Otto creates the element and
 * tells the user to add photos on the elements page. Deletes are SOFT (tombstones; history/snapshots
 * stay intact). $0 by construction: no GenJob, no credits, no provider.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext, EntityType } from "../context.js";

const params = z.object({
  action: z.enum(["create", "delete", "delete_reference_image"]),
  // create — a new element:
  name: z.string().trim().min(1).max(120).optional().describe("create: the element's name (e.g. 'Aisha', 'The kopitiam', 'Signature latte')."),
  type: z
    .enum(["CHARACTER", "LOCATION", "PRODUCT", "BRANDMARK"])
    .optional()
    .describe("create: the element kind. CHARACTER (a person), LOCATION (a place), PRODUCT (a thing you sell), BRANDMARK (a logo/mark)."),
  // delete — which element:
  entityId: z.string().min(1).max(80).optional().describe("delete: the element id to remove (soft delete)."),
  // delete_reference_image — which reference photo:
  refImageId: z.string().min(1).max(80).optional().describe("delete_reference_image: the reference-photo id to remove from its element."),
});

type ManageEntitiesInput = z.infer<typeof params>;

export async function executeManageEntities(
  input: ManageEntitiesInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const entities = ctx.entities;
  if (!entities) return { ok: false, error: "Element management isn't available right now." };

  switch (input.action) {
    case "create": {
      if (!input.name) return { ok: false, error: "create needs a `name`." };
      if (!input.type) return { ok: false, error: "create needs a `type` (CHARACTER | LOCATION | PRODUCT | BRANDMARK)." };
      const r = await entities.create({ name: input.name, type: input.type as EntityType });
      if ("error" in r) return { ok: false, error: r.error };
      // Honest: the element exists but has no reference photos yet (upload is a human file action).
      return {
        ok: true,
        entityId: r.id,
        note: "Created the element with no reference photos yet — the user adds photos on the elements page (uploading a file is something they do by hand).",
      };
    }
    case "delete": {
      if (!input.entityId) return { ok: false, error: "delete needs `entityId`." };
      const r = await entities.remove(input.entityId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "delete_reference_image": {
      if (!input.refImageId) return { ok: false, error: "delete_reference_image needs `refImageId`." };
      const r = await entities.removeReferenceImage(input.refImageId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
  }
}

export const manageEntitiesSkill = defineOttoSkill({
  name: "manageEntities",
  // $0 element management: writes OUR entity/reference rows only. free + write + internal ⇒
  // needsApproval=false — same as the human elements UI. Deletes are soft (reversible tombstones).
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Manage the user's reusable elements — the @-referenceable characters, locations, products and brandmarks — $0, never generates or spends. " +
    "create: a new NAMED element (needs name + type). It has NO reference photos yet — tell the user to add photos on the elements page (uploading a file is something they do by hand). " +
    "delete: remove an element (needs entityId; history stays intact). " +
    "delete_reference_image: remove one reference photo from an element (needs refImageId).",
  parameters: params,
  execute: executeManageEntities,
});

export const manageEntities = manageEntitiesSkill.tool;
