/**
 * saveCustomerSegment — $0 Brand-memory note-card skill, not a CRM Segment action.
 * Use readSegments/buildSegment for saved CRM rules, live audience counts, and Segment create/update.
 */
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
    "Save or update ONE customer-group NOTE CARD in the user's Brand memory (upsert by name; omitted fields are kept). " +
    "This is brand knowledge, NOT a CRM Segment and it has no audience rule or live contact membership. $0. " +
    "Use when the user describes who they sell to — a distinct group with its own pains/wants/channels. " +
    "Keep groups few and meaningful (a brand rarely needs more than ~6). 'who' is required when creating a new group. " +
    "For CRM Segment rules/counts use readSegments; to create or update a CRM Segment use buildSegment.",
  parameters: params,
  execute: async ({ status, ...fields }, runContext) =>
    upsertBrandRecordFromOtto({ kind: "segment", fields, status }, runContext),
});

export const saveCustomerSegment = saveCustomerSegmentSkill.tool;
