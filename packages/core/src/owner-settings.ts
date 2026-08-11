/**
 * Owner-scoped preferences (the `Organization.settings` JSON blob), as a PURE module.
 *
 * It lives in core, not apps/web, because the publish worker must read the same
 * `autoPublish` switch the merchant flips in Settings (#791-2). Two definitions of
 * "is auto-publish on" is exactly how a switch stops meaning anything.
 */
import { INTERNAL_PER_DISPLAY } from "./spend.js";

export type OwnerSettings = {
  /** Schedule: publish approved posts automatically at their time. Read by the publish
   *  scheduler (apps/worker scanDuePublishPosts) — off means the post waits for a human. */
  autoPublish: boolean;
  /** #524 — the merchant's ceiling on ONE paid action, in DISPLAYED credits (0 = no cap).
   *  Enforced inside `reserveCredits` (the single writer of the credit ledger), never in
   *  the UI: see `readSpendCap` below for the one reading of it. */
  spendCapCredits: number;
  timezone: string;           // Schedule default tz (IANA)
  defaultPostTimes: string;   // comma-separated "HH:MM" defaults for Schedule
  vipMinSpendMyr: number;     // CRM VIP preset: minimum lifetime spend in MYR
  vipRecentOrderDays: number; // CRM VIP preset: most recent order window in days
  /** #679 — the merchant closed the "Get Otto ready" card. NOT a Settings-screen preference:
   *  it rides here because `Organization.settings` is the tenant-scoped store that already
   *  exists, so the dismissal follows the shop's account instead of one browser. The Settings
   *  screen builds its sections from a hand-written list, so this key shows up nowhere. */
  ottoOnboardingDismissed: boolean;
};

export const DEFAULT_SETTINGS: OwnerSettings = {
  // Fail-closed default: a workspace that never touched Settings is never auto-published for.
  autoPublish: false,
  spendCapCredits: 0,
  timezone: "Asia/Kuala_Lumpur",
  defaultPostTimes: "09:00,18:00",
  vipMinSpendMyr: 500,
  vipRecentOrderDays: 90,
  // A workspace that has never dismissed the card has not dismissed it — including every
  // workspace that predates this key, whose stored blob simply has no such field.
  ottoOnboardingDismissed: false,
};

/** Pure: overlay a raw JSON blob onto defaults, dropping unknown keys + wrong types.
 *  Keys the product no longer has (the removed notify* toggles, #791-2) are unknown keys
 *  and are dropped here — a stored blob from an older release still reads cleanly. */
export function mergeSettings(raw: unknown): OwnerSettings {
  const out: OwnerSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof OwnerSettings)[]) {
    const v = r[k];
    if (typeof v === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Does this workspace's stored settings blob authorize automatic publishing?
 *  The ONE reading of the switch — used by the publish scheduler. */
export function autoPublishEnabled(rawSettings: unknown): boolean {
  return mergeSettings(rawSettings).autoPublish;
}

/** What the stored spend cap means to the charging path (#524).
 *
 *  Three outcomes, not two — `unreadable` is the fail-closed arm: a caller that cannot tell
 *  what the merchant's ceiling is must REFUSE, never spend. Folding that into "no cap" is
 *  precisely how a guardrail disappears silently. */
export type SpendCapReading =
  | { kind: "none" }                    // 0 = the merchant set no ceiling (the default)
  | { kind: "cap"; internal: number }   // an enforceable ceiling, in INTERNAL credits
  | { kind: "unreadable" };             // stored value is not a whole number of credits ≥ 0

/**
 * The ONE reading of the spend cap (#524) — used by `reserveCredits`, the money authority.
 *
 * Until #524 this setting was a note to itself: `owner-settings.ts` said "display + signal
 * only" and the reserve/settle path never opened it, while the Settings screen told the
 * merchant Otto would pause a task that went over it. This function is what turned the
 * sentence into the behaviour; it lives in core so the ledger writer and the Settings screen
 * cannot drift into two readings of one number.
 *
 * The stored number is in DISPLAYED credits (what the merchant typed); the ledger is in
 * INTERNAL credits, so the conversion goes through `INTERNAL_PER_DISPLAY` rather than a
 * hand-written 10 — the cap has to move with the pricing unit, not beside it.
 *
 * A fractional or negative stored cap is `unreadable`, NOT "no cap": the write path already
 * rejects both (owner-settings-actions.ts), so reaching here means the blob was written by
 * something that is not this product, and the safe reading of a corrupted ceiling is "stop",
 * not "unlimited".
 *
 * A WRONG-TYPED value ("lots") is a different case and is deliberately not caught here: it
 * never survives `mergeSettings`, so the Settings screen and this function both read that
 * workspace as one that never set a cap. Reading it raw would fail closed on the charging
 * path while the screen still said "No cap set" — one number, two answers, which is the class
 * of bug #524 is closing rather than a stricter version of the fix.
 */
export function readSpendCap(rawSettings: unknown): SpendCapReading {
  const cap = mergeSettings(rawSettings).spendCapCredits;
  if (!Number.isInteger(cap) || cap < 0) return { kind: "unreadable" };
  if (cap === 0) return { kind: "none" };
  return { kind: "cap", internal: cap * INTERNAL_PER_DISPLAY };
}
