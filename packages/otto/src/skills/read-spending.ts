/**
 * readSpending — $0 internal-read skill: the merchant's balance and where their credits went (#555).
 *
 * Gate: cost:"free" + effect:"read" + reach:"internal" → needsApproval = false.
 *
 * WHY: an S6 walkthrough found 89% of a session's credits went on Otto conversation turns with
 * no number anywhere, and Otto answered "check your billing page" — a page that could not answer.
 * The page can now, and so can Otto: this reads the SAME owner-scoped ledger rows the Billing
 * spend history renders, through the injected ctx.spending port (single-action-layer rule — no
 * Prisma, no credit service, no fetch in here).
 *
 * HONESTY: the history covers the most recent `taskLimit` items, not all time. The port reports
 * that window and this skill passes it through, so an answer can never claim to cover every
 * charge ever made. Totals are computed HERE, in code, rather than left to the model to add up.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({});
type Input = z.infer<typeof params>;

/** One history item as the port reports it (DISPLAYED credits; `credits` is signed). */
export type SpendingEntry = {
  category: string;
  label: string;
  credits: number;
  at: string;
  pending: boolean;
  detail?: string;
};

export type SpendingTotals = {
  /** Positive total actually SPENT across the window — settled charges only. */
  charged: number;
  /** Positive total still only HELD across the window (unsettled reservations). Kept out of
   *  `charged` and `byCategory`: a hold is not a charge, and the final amount is not known
   *  yet. Round-2 review P1②: folding it in made Otto report money as spent that had not
   *  been, and the instructions tell the model to quote totals verbatim. */
  onHold: number;
  /** Positive total ADDED across the window (top-ups, grants, refunds). */
  added: number;
  /** Positive SETTLED charge per category, e.g. { chat: 7.8, review: 0.7, image: 1 }. */
  byCategory: Record<string, number>;
};

/** Displayed credits carry one decimal; float addition does not. Round every total the same
 *  way the UI formats, so a summed answer never reads as 8.500000000000002. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Add up a window of history. PURE — no I/O. Charges are reported as positive numbers under
 * `charged`/`byCategory` (a merchant asks "how much did I spend", not "what was the delta"),
 * while credits added stay separate so the two are never netted into one confusing figure.
 *
 * A `pending` entry is a HOLD, not a charge: its amount is the reservation ceiling and the
 * real cost is only known when it settles. It is totalled separately under `onHold` and left
 * out of `charged`/`byCategory`, so "what have I spent" can never be answered with money the
 * merchant has not actually spent (round-2 review P1②).
 */
export function summariseSpending(entries: readonly SpendingEntry[]): SpendingTotals {
  let charged = 0;
  let onHold = 0;
  let added = 0;
  const byCategory: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.credits < 0) {
      const amount = -entry.credits;
      if (entry.pending) {
        onHold += amount;
        continue;
      }
      charged += amount;
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + amount;
    } else {
      added += entry.credits;
    }
  }
  for (const key of Object.keys(byCategory)) byCategory[key] = round1(byCategory[key]!);
  return { charged: round1(charged), onHold: round1(onHold), added: round1(added), byCategory };
}

export async function executeReadSpending(
  _input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.spending?.overview) return { error: "Spending information isn't available right now." };
  const result = await ctx.spending.overview();
  if ("error" in result) return result;
  return {
    ok: true as const,
    balance: result.balance,
    reserved: result.reserved,
    window: result.window,
    totals: summariseSpending(result.entries),
    entries: result.entries,
  };
}

export const readSpendingSkill = defineOttoSkill({
  name: "readSpending",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Read the workspace's credit balance and recent credit history — the same rows the merchant " +
    "sees under Billing & credits → Spend history. $0 and read-only: it can never top up, charge, " +
    "or refund. Use it whenever they ask what they have left, what they have spent, or what " +
    "something cost. Returns: balance and reserved (credits held for work in flight); totals " +
    "already added up for you — do not re-add them — where totals.charged is money actually " +
    "SPENT (settled only), totals.onHold is money merely HELD by unfinished work (never add it " +
    "to the spent figure; mention it as not settled yet), totals.added is credits added, and " +
    "totals.byCategory breaks the SETTLED spend down; entries, newest first, each with a plain " +
    "category (Chat = one conversation turn with you, Review = the automatic check after a " +
    "generation, Image, Video, Research, Top-up), a signed credits amount (negative = charged), " +
    "the time, and pending:true when that one is a hold rather than a settled charge. " +
    "IMPORTANT: `window` says how far back this reaches — it covers the most recent " +
    "window.taskLimit items only. If window.hasMore is true there are OLDER charges not included, " +
    "so say your figures cover their recent charges, never 'everything you have ever spent'.",
  parameters: params,
  execute: executeReadSpending,
});

export const readSpending = readSpendingSkill.tool;
