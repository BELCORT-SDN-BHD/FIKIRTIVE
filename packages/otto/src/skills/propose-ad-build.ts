/**
 * proposeAdBuild — $0 write skill (G7 v2)
 *
 * Thin ungated wrapper that calls ctx.metaBuild.propose(input) and returns a friendly message.
 * ALL build/validate/persist logic lives in the web port (apps/web/lib/meta-build-propose.ts).
 *
 * Gate: cost:"free" + effect:"write" + reach:"internal" → needsApproval = false.
 *
 * This skill MUST NOT import meta-graph, prisma, or any web code — enforced by
 * scripts/check-skill-imports.sh (CI fence).
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { isConnectionBlocked, ottoConnectionBlockedAnswer } from "../connection-copy.js";

const NOT_CONNECTED =
  "Meta isn't connected yet. Ask the user to open Connections and connect Instagram or Facebook, then try again.";
const META_UNREACHABLE =
  "I couldn't reach Meta just now — a temporary hiccup on Meta's side, not a connection problem. Try again in a moment.";

export const proposeAdBuildInput = z.object({
  goal: z.string().describe("The strategic goal for this ad (e.g. 'drive traffic to our product page')."),
  reasoning: z.string().describe("Brief reasoning for the ad strategy and targeting choices."),
  mode: z
    .enum(["create", "into_existing"])
    .describe("'create' to create a new campaign + ad set, 'into_existing' to add an ad into an existing ad set."),
  objective: z
    .string()
    .describe(
      "Meta campaign objective. Supported: OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES.",
    ),
  pageId: z.string().describe("The Facebook Page id to use as the ad identity. Get page ids via list-meta-pages."),
  targetingHint: z
    .object({
      countries: z.array(z.string()).optional().describe("ISO 3166-1 alpha-2 country codes. Default: ['MY']."),
      cities: z.array(z.string()).optional().describe("City names for geo targeting."),
      ageMin: z.number().optional().describe("Minimum age for targeting."),
      ageMax: z.number().optional().describe("Maximum age for targeting."),
      interests: z.array(z.string()).optional().describe("Interest names for flexible audience targeting."),
    })
    .optional()
    .describe("Targeting hints. Server shapes these into a valid Meta targeting spec."),
  dailyBudgetMinor: z
    .number()
    .describe("Daily budget in minor currency units (e.g. cents). Must be > 0."),
  startTime: z.string().optional().describe("Optional campaign start time in ISO-8601 format."),
  creative: z
    .object({
      assetId: z.string().describe("The Generation id of the creative asset (image or video)."),
      kind: z.enum(["image", "video"]).describe("The kind of creative asset."),
      message: z.string().describe("The primary ad copy text."),
      headline: z.string().optional().describe("Optional headline text."),
      cta: z.string().describe("Call-to-action button label (e.g. LEARN_MORE, SHOP_NOW, SIGN_UP)."),
      link: z.string().describe("The destination URL for the ad. Must be a valid http/https URL."),
    })
    .describe("The creative content for the ad."),
  intoExisting: z
    .object({
      adsetId: z.string().describe("The existing ad set id to add this ad into. Get ad set ids via meta-list-objects."),
    })
    .optional()
    .describe("Required when mode is 'into_existing'. Specifies the target ad set."),
});

type ProposeAdBuildInput = z.infer<typeof proposeAdBuildInput>;

// ---------------------------------------------------------------------------
// Execute function — exported for direct unit-testing
// ---------------------------------------------------------------------------

export async function executeProposeAdBuild(
  input: ProposeAdBuildInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaBuild) return { message: NOT_CONNECTED };

  const res = await ctx.metaBuild.propose(input);

  // #741 r5 P1: "connected but expired" / "connected without Page access" are not "never
  // connected" — the shared authority answers both, so this skill cannot merge them back in.
  if (isConnectionBlocked(res)) return ottoConnectionBlockedAnswer(res);

  if ("notConnected" in res) {
    return { message: NOT_CONNECTED };
  }

  if ("transientError" in res) {
    return { message: META_UNREACHABLE };
  }

  if ("invalid" in res) {
    // Build a human-readable message from the validation failures
    const messages = res.invalid.map(({ field, reason }) => {
      // Friendly overrides for common failures
      if (field === "creative.assetId" || reason.includes("unknown asset")) {
        return "I couldn't find that image or video in your library. Please provide a valid asset id from your generations.";
      }
      if (field === "objective" || reason.includes("objective")) {
        return `That objective isn't supported yet. Supported objectives: OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES.`;
      }
      if (field === "creative.link" || reason.includes("link")) {
        return "The destination link doesn't look like a valid URL. Please provide a full https:// URL.";
      }
      if (field === "pageId" || reason.includes("page")) {
        return "That Facebook Page wasn't found in your connected pages. Use list-meta-pages to get valid page ids.";
      }
      return `Validation failed for ${field}: ${reason}.`;
    });
    return { message: messages.join(" ") };
  }

  return {
    message: `Ad build proposal prepared and ready for review (card id: ${res.cardId}).`,
    cardId: res.cardId,
    autoBuilt: res.autoBuilt,
  };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const proposeAdBuildSkill = defineOttoSkill({
  name: "propose-ad-build",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Build a Meta ad creation proposal (BUILD_CARD) the user can review and confirm. " +
    "Use this when the user wants to create a new Meta ad from one of their generated assets. " +
    "Provide the strategy fields: goal, reasoning, mode, objective, pageId, dailyBudgetMinor, creative " +
    "(assetId from their generations, kind, message, cta, link). Server validates all fields, resolves " +
    "targeting, and builds the card. Always call list-meta-pages first to get valid pageId values. " +
    "This is $0 and ungated.",
  parameters: proposeAdBuildInput,
  execute: executeProposeAdBuild,
});

export const proposeAdBuild = proposeAdBuildSkill.tool;
