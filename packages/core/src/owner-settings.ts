/**
 * Owner-scoped preferences (the `Organization.settings` JSON blob), as a PURE module.
 *
 * It lives in core, not apps/web, because the publish worker must read the same
 * `autoPublish` switch the merchant flips in Settings (#791-2). Two definitions of
 * "is auto-publish on" is exactly how a switch stops meaning anything.
 */
export type OwnerSettings = {
  /** Schedule: publish approved posts automatically at their time. Read by the publish
   *  scheduler (apps/worker scanDuePublishPosts) — off means the post waits for a human. */
  autoPublish: boolean;
  spendCapCredits: number;    // OTTO soft cap (display + signal only; 0 = no cap)
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
