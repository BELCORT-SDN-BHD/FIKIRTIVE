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
 * WHY IT READS THE BLOB RAW INSTEAD OF THROUGH `mergeSettings` (r1 judge P1-1). `mergeSettings`
 * answers "what should the screen show", and its answer for a wrong-TYPED value is to drop it
 * and fall back to the default — which for this key is 0, i.e. NO CAP. On the charging path
 * that is fail OPEN: a stored `"5"` would let every amount through. A string, an object, a
 * boolean, an explicit `null`, `NaN`, a fraction and a negative are all one threat — a value
 * this product's write path cannot produce (owner-settings-actions.ts rejects them), so the
 * blob was written by something that is not this product. Every one of those shapes is
 * `unreadable` here, and `unreadable` refuses.
 *
 * The one shape that must NOT be caught is "never set": a workspace that has never opened
 * Settings has no `spendCapCredits` key at all, and a merchant who set no ceiling must not be
 * stopped. Absent key (and a `null`/absent settings blob) = `none`; a present-but-invalid
 * value = `unreadable`. That distinction is the whole function.
 */
export function readSpendCap(rawSettings: unknown): SpendCapReading {
  // No blob at all = a workspace that never touched Settings. Not corruption; no ceiling.
  if (rawSettings === null || rawSettings === undefined) return { kind: "none" };
  // A settings blob that is not a plain object cannot be searched for the key, so we cannot
  // tell a set cap from an unset one — refuse rather than guess "unlimited".
  if (typeof rawSettings !== "object" || Array.isArray(rawSettings)) return { kind: "unreadable" };
  const stored = (rawSettings as Record<string, unknown>).spendCapCredits;
  if (stored === undefined) return { kind: "none" }; // key never written → no ceiling set
  // Present. From here the ONLY acceptable shape is a whole number of credits ≥ 0.
  // `Number.isInteger` already rejects NaN, ±Infinity, fractions and every non-number
  // (string/object/boolean/null), so this one test covers the whole corrupted-value family.
  if (!Number.isInteger(stored) || (stored as number) < 0) return { kind: "unreadable" };
  const cap = stored as number;
  if (cap === 0) return { kind: "none" }; // the merchant's own "No cap set"
  return { kind: "cap", internal: cap * INTERNAL_PER_DISPLAY };
}
