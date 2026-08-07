/**
 * otto-money-view — the money boundary for Otto's chat surface (#692 r3).
 *
 * Three review rounds tried to keep Otto honest about currency by TELLING it the rules. That
 * never held: the rule lived in a TypeScript comment the model never sees, while the payload
 * handed it plain, addable amounts. So the rule moved into the shape. Every money field crosses
 * this boundary as FINISHED TEXT — carrying its currency code, or naming the account when Meta
 * reported no currency — and the numeric field is gone. "Add these two figures" is no longer an
 * operation available on what the model was given.
 *
 * What stays numeric: counts (reach, impressions, clicks) and ratios (CTR, ROAS, frequency).
 * Those ARE comparable across accounts — a person reached is a person reached, and a ratio has
 * no denomination — and withholding them would cost Otto real analysis for no truth gained.
 *
 * `moneyBucket` is the same key the Analytics cards bucket by (moneyBucketKey), so the human
 * screen and the chat answer can never disagree about which figures share a denomination.
 */
import { currencyCode, moneyBucketKey } from "./analytics-view";
import type { AccountInsights } from "./meta-insights";
import type { OwnerAdRow } from "./meta-performance";

/** Money as finished text — never a number, never a bare numeric string. */
export type OttoMoney = { spend: string; cpc: string; cpm: string };

/** The non-money metrics, exactly as Meta reported them. Safe to compare across accounts. */
export type OttoComparableMetrics = {
  impressions: string | null;
  reach: string | null;
  frequency: string | null;
  clicks: string | null;
  ctr: string | null;
  purchaseRoas: string | null;
};

export type OttoInsightAccount = {
  accountId: string;
  name: string;
  currency: string | null;
  moneyBucket: string;
  money: OttoMoney;
  metrics: OttoComparableMetrics;
};

export type OttoAdRow = {
  adId: string;
  adName: string | null;
  accountId: string;
  accountName: string | null;
  currency: string | null;
  moneyBucket: string;
  money: OttoMoney;
  /** Did this ad actually spend anything? The only thing the diagnosis ever needed the amount
   *  for, reduced to a fact that cannot be summed or ranked. */
  hasSpend: boolean;
  metrics: OttoComparableMetrics;
  creative: OwnerAdRow["creative"];
};

/** A never-blank way to name an account, so an unlabelled figure can always be placed. */
function label(account: { accountId: string; name?: string | null }): string {
  return account.name?.trim() || account.accountId;
}

/** Meta's numeric strings only; anything unparseable is treated as absent (anti-fabrication). */
function amount(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * One money figure, finished. "MYR 612" when Meta reported a currency; otherwise the figure is
 * tied to the one account it belongs to — "1240 (currency not reported — Kaia Cafe)" — so it can
 * never be read as part of a shared pool, not even with another unlabelled account's figure.
 * Absent/unparseable → "—".
 */
function finishedMoney(raw: string | null | undefined, currency: string | null, accountLabel: string): string {
  if (amount(raw) == null) return "—";
  const text = String(raw);
  const code = currencyCode(currency);
  return code === "" ? `${text} (currency not reported — ${accountLabel})` : `${code} ${text}`;
}

function comparable(m: Record<string, string | null>): OttoComparableMetrics {
  return {
    impressions: m.impressions ?? null,
    reach: m.reach ?? null,
    frequency: m.frequency ?? null,
    clicks: m.clicks ?? null,
    ctr: m.ctr ?? null,
    purchaseRoas: m.purchaseRoas ?? null,
  };
}

/** Account-level insights → the chat-facing shape. Money out as text, never as an amount. */
export function toOttoInsightAccounts(accounts: readonly AccountInsights[]): OttoInsightAccount[] {
  return accounts.map((a) => {
    const who = label(a);
    return {
      accountId: a.accountId,
      name: a.name,
      currency: a.currency,
      moneyBucket: moneyBucketKey(a),
      money: {
        spend: finishedMoney(a.metrics.spend, a.currency, who),
        cpc: finishedMoney(a.metrics.cpc, a.currency, who),
        cpm: finishedMoney(a.metrics.cpm, a.currency, who),
      },
      metrics: comparable(a.metrics as unknown as Record<string, string | null>),
    };
  });
}

/** Per-ad performance → the chat-facing shape. Same boundary, same guarantees. */
export function toOttoAdRows(ads: readonly OwnerAdRow[]): OttoAdRow[] {
  return ads.map((a) => {
    const who = a.accountName?.trim() || a.accountId;
    const spend = amount(a.metrics.spend);
    return {
      adId: a.adId,
      adName: a.adName,
      accountId: a.accountId,
      accountName: a.accountName,
      currency: a.currency,
      moneyBucket: moneyBucketKey(a),
      money: {
        spend: finishedMoney(a.metrics.spend, a.currency, who),
        cpc: finishedMoney(a.metrics.cpc, a.currency, who),
        cpm: finishedMoney(a.metrics.cpm, a.currency, who),
      },
      hasSpend: spend != null && spend > 0,
      metrics: comparable(a.metrics),
      creative: a.creative,
    };
  });
}
