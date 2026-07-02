/** saveOffer — $0 skill. Upserts ONE offer/promotion (by title) in Brand memory. */
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";

const params = z.object({
  title: z.string().min(1).max(160),
  details: z.string().max(400).optional(),
  code: z.string().max(60).optional(),
  appliesTo: z.string().max(200).optional(),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
});

export const saveOfferSkill = defineOttoSkill({
  name: "saveOffer",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Save or update ONE offer/promotion in the user's Brand memory (upsert by title; omitted fields are kept). $0. " +
    "Use when the user mentions a sale, discount, promo code or campaign period. Record endsAt whenever known — " +
    "expired offers are automatically excluded from your context. 'Extend the Raya sale to the 20th' = same title, new endsAt.",
  parameters: params,
  execute: async ({ startsAt, endsAt, ...fields }, runContext) =>
    upsertBrandRecordFromOtto({ kind: "offer", fields, startsAt, endsAt }, runContext),
});

export const saveOffer = saveOfferSkill.tool;
