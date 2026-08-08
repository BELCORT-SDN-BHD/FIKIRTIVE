/**
 * The ONE place a Meta ad account's `account_status` becomes something a merchant can read (#693).
 *
 * That field is a numeric code. Connections used to print it verbatim — every ad account read
 * "MYR · 1", and a suspended account read "MYR · 2", so the one fact that matters ("my ad account
 * is stopped") never reached the screen at all. Same family as #683 (internal ledger notes shown to
 * the merchant): an internal code handed straight to the customer.
 *
 * Every customer-facing reader goes through describeMetaAdAccountStatus — the table below is the
 * single authority, and no caller renders `MetaAdAccount.status` itself. New codes will appear;
 * the unknown branch must still say something TRUE rather than guess a meaning, exactly like
 * describeConnectError's default branch in OttoConnections.
 */

export type MetaAdAccountStatusView = {
  /** What the merchant reads. English sentence case, never a code, never Meta's enum name. */
  label: string;
  /** What it means for their ads. Present whenever the status is not simply "everything is fine". */
  detail: string | null;
  /** ok = ads can run · attention = they cannot (or soon cannot) · unknown = we don't recognise it. */
  tone: "ok" | "attention" | "unknown";
};

// Meta's account_status enum, real account states only. 201 (ANY_ACTIVE) and 202 (ANY_CLOSED) are
// deliberately absent: they are query FILTER values, not states an account is ever in, so any prose
// for them would be invented. They fall to the honest unknown branch below.
const STATUS_TABLE: Record<number, MetaAdAccountStatusView> = {
  // ACTIVE
  1: { label: "Active", detail: null, tone: "ok" },
  // DISABLED
  2: {
    label: "Disabled",
    detail: "Ads can't run from this account until Meta re-enables it.",
    tone: "attention",
  },
  // UNSETTLED
  3: {
    label: "Unpaid balance",
    detail: "Meta has stopped this account's ads until the outstanding balance is paid.",
    tone: "attention",
  },
  // PENDING_RISK_REVIEW
  7: {
    label: "Under review",
    detail: "Meta is reviewing this account — ads can't run until that finishes.",
    tone: "attention",
  },
  // PENDING_SETTLEMENT
  8: {
    label: "Awaiting payment",
    detail: "Meta is still collecting a payment on this account — ads can't run until it goes through.",
    tone: "attention",
  },
  // IN_GRACE_PERIOD — ads genuinely still run, so this is not an alarm; it is still worth saying.
  9: {
    label: "In grace period",
    detail: "Ads still run for now, but Meta needs a working payment method on this account.",
    tone: "ok",
  },
  // PENDING_CLOSURE
  100: {
    label: "Closing",
    detail: "This account is being closed — ads will stop once it is.",
    tone: "attention",
  },
  // CLOSED
  101: {
    label: "Closed",
    detail: "This account is closed — ads can't run from it.",
    tone: "attention",
  },
};

/** Every code this table recognises. Exported so the mapping's coverage can be pinned, not assumed. */
export const META_AD_ACCOUNT_STATUS_CODES: readonly number[] = Object.keys(STATUS_TABLE).map(Number);

const UNKNOWN: MetaAdAccountStatusView = {
  label: "Unknown status",
  // Don't invent a cause, and don't print the code at the merchant — point at the one place they
  // can see the real answer for themselves.
  detail: "We don't recognise what Meta reported for this account — check it in Meta Ads Manager.",
  tone: "unknown",
};

/**
 * A merchant-readable view of a Meta `account_status`, or null when Meta reported none — an absent
 * status is not an unknown one, so nothing is shown rather than an invented "Unknown status".
 */
export function describeMetaAdAccountStatus(
  raw: string | number | null | undefined,
): MetaAdAccountStatusView | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const code = Number(text);
  if (!Number.isInteger(code)) return UNKNOWN;
  return STATUS_TABLE[code] ?? UNKNOWN;
}
