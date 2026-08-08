export type OwnerSettings = {
  autoPublish: boolean;       // Schedule: auto-publish approved posts at their time
  spendCapCredits: number;    // OTTO soft cap (display + signal only; 0 = no cap)
  notifyEmail: boolean;       // email notifications
  notifyInApp: boolean;       // in-app notifications
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
  autoPublish: false,
  spendCapCredits: 0,
  notifyEmail: true,
  notifyInApp: true,
  timezone: "Asia/Kuala_Lumpur",
  defaultPostTimes: "09:00,18:00",
  vipMinSpendMyr: 500,
  vipRecentOrderDays: 90,
  // A workspace that has never dismissed the card has not dismissed it — including every
  // workspace that predates this key, whose stored blob simply has no such field.
  ottoOnboardingDismissed: false,
};

/** Pure: overlay a raw JSON blob onto defaults, dropping unknown keys + wrong types. */
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
