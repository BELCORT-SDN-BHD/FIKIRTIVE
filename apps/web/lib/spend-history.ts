/**
 * spend-history — PURE read-side shaping of CreditLedger rows into the merchant-facing
 * spend history rendered on /billing (#555).
 *
 * WHY THIS EXISTS: every charge was already in the ledger, but the product showed only a
 * balance — a merchant could not see that ~89% of a session's credits went on Otto
 * conversation turns. This module turns the ledger's mechanics (RESERVE / SETTLE / REFUND
 * pairs, internal credits, refId prefixes) into what a shop owner actually reads: one row
 * per thing that happened, in plain categories, at the net amount really charged.
 *
 * MONEY SAFETY: display only. Nothing here reserves, settles, refunds, or reads a balance —
 * it reshapes rows the caller already fetched. Amounts are converted to DISPLAYED credits
 * at the view seam (displayCredits) and never fed back into the ledger.
 *
 * Related but deliberately separate: account-actions' `mergeByTask` shapes the SHORT
 * activity preview inside Otto settings. It filters zero-delta rows (a generation settles at
 * exactly the reserved amount → balanceDelta 0), which is fine for a preview but would make a
 * finished job here look like an unsettled hold. This module therefore takes EVERY row of a
 * task and decides "settled" from the presence of a SETTLE/REFUND row, not from its amount.
 */
import { displayCredits } from "@fikirtive/core";
import { formatCredits } from "./credit-format";
import { partsInTz, formatDayLabel, formatTime } from "./schedule-view";

/** What a merchant sees this charge as. Derived from the ledger row, never guessed. */
export type SpendCategory =
  | "chat"        // an Otto conversation turn (otto-stream / otto-turn / otto-approve)
  | "review"      // the automatic post-generation verdict (otto-verdict)
  | "research"    // an approved deep-research run (research:)
  | "image"       // a generation job that made image(s)
  | "video"       // a generation job that made video
  | "topup"       // a Stripe credit purchase
  | "grant"       // a non-purchase credit grant (beta seed, promo, admin)
  | "adjustment"  // an admin correction
  | "other";      // a real row we cannot categorise — shown, never hidden or mislabelled

export const SPEND_CATEGORY_LABEL: Record<SpendCategory, string> = {
  chat: "Chat",
  review: "Review",
  research: "Research",
  image: "Image",
  video: "Video",
  topup: "Top-up",
  grant: "Credits added",
  adjustment: "Adjustment",
  other: "Credit change",
};

/** Exactly the CreditLedger columns the history needs (a subset of the row). */
export type SpendLedgerRow = {
  id: string;
  kind: string; // CreditTxnKind
  source: string; // CreditTxnSource
  reason: string | null;
  refId: string | null;
  balanceDelta: number; // INTERNAL credits, signed
  reservedDelta: number; // INTERNAL credits, signed
  createdAt: Date;
};

/** One thing that happened, as the merchant reads it. */
export type SpendEntry = {
  /** The id of the task's most recent ledger row — stable React key. */
  id: string;
  category: SpendCategory;
  label: string;
  /** NET signed change in DISPLAYED credits (negative = charged, positive = added). */
  delta: number;
  at: string; // ISO timestamp of the task's most recent event
  atLabel: string; // pre-formatted in the merchant's own timezone, locale-fixed
  /** True while a hold is still open — the final cost is not known yet. */
  pending: boolean;
  /** Merchant-facing extra line: the hold notice, or the used/refunded split. */
  detail?: string;
};

/**
 * Category for one ledger row. `jobKindByRefId` maps a bare generation-job refId to what
 * that job made; a refId absent from it is never assumed to be a generation.
 */
export function spendCategoryOf(
  row: { refId: string | null; kind: string; source: string },
  jobKindByRefId: ReadonlyMap<string, "IMAGE" | "VIDEO">,
): SpendCategory {
  const { refId } = row;
  if (refId) {
    if (refId.startsWith("otto-verdict:")) return "review";
    if (refId.startsWith("otto-")) return "chat";
    if (refId.startsWith("research:")) return "research";
    const jobKind = jobKindByRefId.get(refId);
    if (jobKind === "IMAGE") return "image";
    if (jobKind === "VIDEO") return "video";
    return "other";
  }
  if (row.kind === "GRANT") return row.source === "PURCHASE" ? "topup" : "grant";
  if (row.kind === "ADJUST") return "adjustment";
  return "other";
}

/**
 * Fold ledger rows into the merchant-facing history.
 *
 * One task = one refId (a generation job, an Otto turn, a research run); rows with no refId
 * (grants, top-ups, adjustments) each stay their own entry. A task's rows are summed, so a
 * turn that held 12 credits and settled at 3.3 reads as ONE 3.3-credit charge, not as two
 * ledger mechanics. Order is preserved: `rows` arrive newest-first and a task keeps the
 * position of its newest row.
 *
 * Pure and order-preserving — it only reshapes rows the caller fetched.
 */
export function buildSpendHistory(
  rows: readonly SpendLedgerRow[],
  jobKindByRefId: ReadonlyMap<string, "IMAGE" | "VIDEO">,
  tz: string,
): SpendEntry[] {
  const order: string[] = [];
  const groups = new Map<string, SpendLedgerRow[]>();
  for (const r of rows) {
    const key = r.refId ?? `row:${r.id}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.push(key);
    }
    group.push(r);
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    const latest = group.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const netInternal = group.reduce((sum, r) => sum + r.balanceDelta, 0);
    const reserve = group.find((r) => r.kind === "RESERVE");
    const closer = group.find((r) => r.kind === "SETTLE" || r.kind === "REFUND");
    const pending = !!reserve && !closer;

    let detail: string | undefined;
    if (pending) {
      detail = "On hold — the final cost is charged when this finishes";
    } else if (reserve && closer) {
      const heldInternal = -reserve.balanceDelta; // RESERVE.balanceDelta is always negative
      const returnedInternal = closer.balanceDelta; // the portion given back
      const usedInternal = heldInternal - returnedInternal;
      if (returnedInternal > 0) {
        detail = usedInternal > 0
          ? `${formatCredits(displayCredits(usedInternal))} credits used · ${formatCredits(displayCredits(returnedInternal))} refunded`
          : "Held, then refunded in full";
      }
    }

    const category = spendCategoryOf(latest, jobKindByRefId);
    const parts = partsInTz(latest.createdAt, tz);
    return {
      id: latest.id,
      category,
      label: SPEND_CATEGORY_LABEL[category],
      delta: displayCredits(netInternal),
      at: latest.createdAt.toISOString(),
      atLabel: `${formatDayLabel(parts)}, ${formatTime(parts)}`,
      pending,
      detail,
    };
  });
}
