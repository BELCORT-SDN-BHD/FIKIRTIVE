/**
 * buildSegment — $0 CRM Segment create/update parity (B0-61/C3).
 *
 * Writes only through the injected Segment action port shared with the human CRM page. The input is
 * a closed structured rule group; this skill does not compile or guess from natural-language prose.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { crmSegmentRuleGroup } from "./read-segments.js";
import { CRM_SEGMENT_AVAILABILITY } from "./_availability.js";

const params = z.object({
  operation: z.enum(["create", "update"]),
  segmentId: z
    .string()
    .optional()
    .describe("update only: exact CRM Segment id returned by readSegments. Never guess an id."),
  name: z.string().trim().min(1).max(120),
  rules: crmSegmentRuleGroup.describe(
    "Structured, one-level CRM rule group. Never pass natural-language prose.",
  ),
});

type BuildSegmentInput = z.infer<typeof params>;

export async function executeBuildSegment(
  input: BuildSegmentInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const segments = runContext?.context?.segments;
  if (!segments) return { ok: false, error: "CRM segments aren't available right now." };
  if (input.operation === "update" && !input.segmentId) {
    return { ok: false, error: "update needs the exact `segmentId` from readSegments." };
  }
  if (input.operation === "create" && input.segmentId) {
    return { ok: false, error: "create uses a server-issued Segment id; omit `segmentId`." };
  }
  return segments.build({
    operation: input.operation,
    segmentId: input.segmentId,
    name: input.name,
    rules: input.rules,
  });
}

export const buildSegmentSkill = defineOttoSkill({
  name: "buildSegment",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Create or update one CRM Segment through the same validated, owner-scoped action layer the merchant's own screens use. $0 " +
    "internal write. Pass a STRUCTURED one-level rule object only; never compile or send free-form natural language " +
    "inside this skill. create needs name + rules and uses a server-issued id. update also needs the exact segmentId " +
    "returned by readSegments. Unknown consent stays in the audience; only known opt-out is excluded from the " +
    "contactable estimate, and do-not-disturb remains a send-time restriction. The rule group's optional " +
    "excludeReportedOptOut additionally leaves out every contact the user recorded an opt-out for himself, " +
    "including one who also opted out through their own channel; it only removes people, never adds any, it is " +
    "off unless the user asked for it, and it applies to this segment's counts, preview and broadcasts alike. " +
    CRM_SEGMENT_AVAILABILITY,
  parameters: params,
  execute: executeBuildSegment,
});

export const buildSegment = buildSegmentSkill.tool;
