/**
 * readSegments — $0 CRM Segment read parity (B0-61/C3).
 *
 * Lists saved CRM Segments, reads one owner-scoped Segment with its structured rule/counts, or
 * previews one structured rule group. It reaches CRM only through the injected Segment action port.
 * Natural-language compilation is deliberately outside this skill: the model must submit the closed
 * structured rule object, and the shared action validator checks it again.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { CRM_SEGMENT_AVAILABILITY } from "./_availability.js";

export const crmSegmentRule = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lifetime_spend"),
      comparison: z.enum(["at_least", "more_than"]),
      amountMyr: z.number().finite().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal("last_order_recency"), withinDays: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("channel"), channel: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/) }).strict(),
  z.object({ kind: z.literal("tag"), tag: z.string().min(1).max(80) }).strict(),
  z
    .object({
      kind: z.literal("contactability"),
      value: z.enum(["contactable", "not_contactable"]),
    })
    .strict(),
]);

export const crmSegmentRuleGroup = z
  .object({
    match: z.enum(["all", "any"]),
    rules: z.array(crmSegmentRule).min(1),
    /**
     * #758 — the merchant's optional tightening, carried on the rule group so Otto reaches it
     * through the same field the CRM page uses and the same validator checks it again. Never set
     * it because it sounds safer: it excludes people on the merchant's own unverified record, so
     * it goes on only when the user asked for it.
     */
    excludeReportedOptOut: z
      .boolean()
      .optional()
      .describe(
        "Optional, defaults to off. On: also leave out every contact the user has recorded an opt-out for himself, including one who additionally opted out through their own channel. It only removes contacts from this segment; it never adds one, and it does not change what the consent record decides. Set it only when the user asked to exclude the contacts he recorded.",
      ),
  })
  .strict();

const params = z.object({
  operation: z.enum(["list", "get", "preview"]),
  segmentId: z
    .string()
    .optional()
    .describe("get: exact CRM Segment id returned by list. Never guess an id."),
  rules: crmSegmentRuleGroup
    .optional()
    .describe("preview: one structured, one-level rule group. Never pass natural-language prose."),
});

type ReadSegmentsInput = z.infer<typeof params>;

export async function executeReadSegments(
  input: ReadSegmentsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const segments = runContext?.context?.segments;
  if (!segments) return { ok: false, error: "CRM segments aren't available right now." };

  switch (input.operation) {
    case "list":
      return segments.list();
    case "get":
      if (!input.segmentId) return { ok: false, error: "get needs the exact `segmentId` from list." };
      return segments.get(input.segmentId);
    case "preview":
      if (!input.rules) return { ok: false, error: "preview needs a structured `rules` object." };
      return segments.preview(input.rules);
  }
}

export const readSegmentsSkill = defineOttoSkill({
  name: "readSegments",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Read the user's CRM Segments through the same owner-scoped action layer the merchant's own screens use. $0 read-only. " +
    "operation=list returns saved segments with rules and live matched/contactable/known-opt-out counts. " +
    "operation=get needs an exact segmentId from list and returns that Segment's rule and counts. " +
    "operation=preview evaluates a STRUCTURED one-level rule object without saving. Never send free-form natural " +
    "language as rules and never guess an id. Contactable here is an audience estimate: unknown consent stays " +
    "included, only known opt-out is excluded, and do-not-disturb is enforced later at send time. A rule group may " +
    "also carry excludeReportedOptOut: on, it additionally leaves out every contact the user recorded an opt-out " +
    "for himself, and the count comes back as excludedByReportedOptOutCount. It only ever removes people, and it " +
    "does not change what the consent record already decides. " +
    CRM_SEGMENT_AVAILABILITY,
  parameters: params,
  execute: executeReadSegments,
});

export const readSegments = readSegmentsSkill.tool;
