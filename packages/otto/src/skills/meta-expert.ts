/**
 * metaExpert — $0 skill (P2b)
 *
 * Reads the owner's connected per-ad Meta performance (ctx.metaPerformance, P1a), runs the
 * KB-grounded diagnosis engine (P2a's diagnosePerformance + META_EXPERTISE_KB), and persists
 * a PERFORMANCE_CARD chat message. Spends NO money, creates NO GenJob. Identity from ctx only.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { diagnosePerformance } from "../diagnosis/diagnose-performance.js";
import { META_EXPERTISE_KB } from "../knowledge/meta-expertise.js";
import { buildPerformanceCardPayload } from "./meta-expert.helpers.js";
import { isConnectionBlocked, metaNotConnectedMessage, ottoConnectionBlockedAnswer } from "../connection-copy.js";

const NOT_CONNECTED = metaNotConnectedMessage();
const META_UNREACHABLE =
  "I couldn't reach Meta just now — a temporary hiccup on Meta's side, not a connection problem. Try again in a moment.";

export const metaExpertInput = z.object({
  datePreset: z
    .enum(["last_7d", "last_14d", "last_30d", "last_90d"])
    .default("last_30d")
    .describe("The reporting window to diagnose ad performance over."),
});

type MetaExpertInput = z.infer<typeof metaExpertInput>;

// ---------------------------------------------------------------------------
// Execute function — exported for direct unit-testing (same pattern as meta-insights)
// ---------------------------------------------------------------------------

export async function executeMetaExpert(
  input: MetaExpertInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ message: string } | { cardId: string; summary: string }> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaPerformance) return { message: NOT_CONNECTED };

  const res = await ctx.metaPerformance.getAds(input.datePreset);
  // #741 r5 P1: "connected but expired" is not "never connected" — ask the shared
  // authority first, so this skill cannot answer both with the same sentence.
  if (isConnectionBlocked(res)) return ottoConnectionBlockedAnswer(res);
  if ("notConnected" in res) return { message: NOT_CONNECTED };
  if ("transientError" in res) return { message: META_UNREACHABLE };
  if (res.ads.length === 0) {
    return { message: "Meta is connected, but no ads ran in this window to diagnose yet." };
  }

  // Grounded heuristic: ROAS present ⇒ conversion objective — real evidence, not a guess.
  const objective = res.ads.some((a) => a.metrics.purchaseRoas != null) ? "conversions" : undefined;

  const diagnosis = diagnosePerformance(
    // #692 r3: hasSpend replaces the spend amount — the diagnosis ranks on ratios and only
    // ever needed to know whether an ad actually ran.
    res.ads.map((a) => ({ adId: a.adId, adName: a.adName, hasSpend: a.hasSpend, metrics: a.metrics })),
    META_EXPERTISE_KB,
    objective ? { objective } : undefined,
  );

  const payload = buildPerformanceCardPayload({
    diagnosis,
    datePreset: res.datePreset,
    fetchedAt: res.fetchedAt,
    truncated: res.truncated,
    ads: res.ads.map((a) => ({ adId: a.adId, imageUrl: a.creative?.imageUrl ?? null, isVideo: !!a.creative?.videoId })),
  });

  const last = await prisma.chatMessage.findFirst({
    where: { threadId: ctx.threadId, ownerId: ctx.orgId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });

  const cardId = newId();
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId: ctx.threadId,
      ownerId: ctx.orgId,
      role: "AGENT",
      kind: "PERFORMANCE_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload,
    },
  });

  return {
    cardId,
    summary: "I've laid out which of your ads are winning and which need attention, with the reasons I can back up.",
  };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const metaExpertSkill = defineOttoSkill({
  name: "meta-expert",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Diagnose the user's Meta ad performance: which specific ads/creatives are winning vs. underperforming, " +
    "ranked against THEIR OWN account average (never a made-up industry benchmark), with grounded reasons — " +
    "creative levers cite Meta best-practice, and causes I can't see (learning phase, audience, budget) are " +
    "flagged honestly, not asserted. Lays out a PERFORMANCE_CARD. $0, no approval. Use when the user asks how " +
    "their ads are doing / which is best / what to fix.",
  parameters: metaExpertInput,
  execute: executeMetaExpert,
});

export const metaExpert = metaExpertSkill.tool;
