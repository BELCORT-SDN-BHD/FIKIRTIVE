/** saveProduct — $0 skill. Upserts ONE product record (by name) in Brand memory. */
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";

const params = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  price: z.string().max(60).optional(),
  url: z.string().max(500).optional(),
  sellingAngle: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  category: z.string().max(40).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const saveProductSkill = defineOttoSkill({
  name: "saveProduct",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Save or update ONE product in the user's Brand memory (upsert by name — mentioning an existing product's name updates it, and fields you omit are kept). " +
    "$0. Use when the user describes something they sell, changes a price/angle, or asks you to record products (e.g. from their website). " +
    "price is display text like 'RM 49' — only record a price the user or their site actually stated. Set status:'archived' to retire a product." +
    " Use category to file the product (pick an existing category from your context when one fits; otherwise create a concise new one — e.g. 'Coffee', 'Merch'). When the user asks you to organize/categorize their products, update each product's category via this skill.",
  parameters: params,
  execute: async ({ status, ...fields }, runContext) =>
    upsertBrandRecordFromOtto({ kind: "product", fields, status }, runContext),
});
