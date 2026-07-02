/** saveCustomerSegment — $0 skill. Upserts ONE customer group card (by name) in Brand memory. */
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { upsertBrandRecordFromOtto } from "./_brand-record.js";

const params = z.object({
  name: z.string().min(1).max(120),
  who: z.string().min(1).max(400).optional(),
  pains: z.string().max(400).optional(),
  wants: z.string().max(400).optional(),
  channels: z.string().max(200).optional(),
  toneTips: z.string().max(300).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const saveCustomerSegmentSkill = defineOttoSkill({
  name: "saveCustomerSegment",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Save or update ONE customer group in the user's Brand memory (upsert by name; omitted fields are kept). $0. " +
    "Use when the user describes who they sell to — a distinct group with its own pains/wants/channels. " +
    "Keep groups few and meaningful (a brand rarely needs more than ~6). 'who' is required when creating a new group.",
  parameters: params,
  execute: async ({ status, ...fields }, runContext) =>
    upsertBrandRecordFromOtto({ kind: "segment", fields, status }, runContext),
});

export const saveCustomerSegment = saveCustomerSegmentSkill.tool;
