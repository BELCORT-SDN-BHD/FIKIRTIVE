import { prisma } from "@fikirtive/db";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, listCampaigns, listAdSets, listAds } from "./meta-graph";
import { classifyMetaGraphError } from "./meta-errors";

export type MetaAdObject = {
  id: string;
  level: "campaign" | "adset" | "ad";
  name: string;
  status: string;
  dailyBudgetMinor?: number;
  lifetimeBudgetMinor?: number;
  startTime?: string;
  endTime?: string;
  currency: string;
  accountId: string;
};

export type MetaAdAccount = { id: string; name: string; currency: string };

/** Owner-scoped list of ad accounts. Plain server fn — NOT a "use server" action. */
export async function fetchOwnerAdAccounts(
  ownerId: string,
): Promise<{ accounts: MetaAdAccount[] } | { needsReconnect: true } | { transientError: true } | { notConnected: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { notConnected: true };
  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }
  try {
    const j = await metaGraphGet(token, "me/adaccounts", { fields: "id,account_id,name,currency" });
    const accounts: MetaAdAccount[] = (j.data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.id ?? `act_${a.account_id ?? ""}`),
      name: String(a.name ?? ""),
      currency: String(a.currency ?? ""),
    }));
    return { accounts };
  } catch (e) {
    return classifyMetaGraphError(ownerId, e);
  }
}

/** Owner-scoped read of all campaigns/adsets/ads across the owner's connected ad accounts.
 *  Plain server fn — NOT a "use server" action — so there is no IDOR surface. Token stays here. */
export async function fetchOwnerAdObjects(
  ownerId: string,
): Promise<{ objects: MetaAdObject[] } | { needsReconnect: true } | { transientError: true } | { notConnected: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { notConnected: true };

  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }

  try {
    const accountList = await metaGraphGet(token, "me/adaccounts", { fields: "id,account_id,name,currency" });
    const accounts: Record<string, unknown>[] = accountList.data ?? [];
    const accountIds: string[] = accounts.map((a) => String(a.id ?? `act_${a.account_id ?? ""}`));

    // Meta does NOT return `currency` on campaign/adset/ad nodes — only on the ad ACCOUNT.
    // Build accountId → currency so every object inherits its account's currency (never a node field).
    const currencyByAccount = new Map<string, string>();
    for (const a of accounts) {
      const id = String(a.id ?? `act_${a.account_id ?? ""}`);
      currencyByAccount.set(id, String(a.currency ?? ""));
    }
    const currencyFor = (accountId: string): string => currencyByAccount.get(accountId) ?? "";

    const objects: MetaAdObject[] = [];

    for (const accountId of accountIds) {
      const [campaigns, adsets, ads] = await Promise.all([
        listCampaigns(token, accountId),
        listAdSets(token, accountId),
        listAds(token, accountId),
      ]);

      for (const c of campaigns as Record<string, unknown>[]) {
        const acct = String(c.account_id ?? accountId);
        objects.push({
          id: String(c.id ?? ""),
          level: "campaign",
          name: String(c.name ?? ""),
          status: String(c.effective_status ?? ""),
          dailyBudgetMinor: c.daily_budget != null ? parseInt(String(c.daily_budget), 10) : undefined,
          lifetimeBudgetMinor: c.lifetime_budget != null ? parseInt(String(c.lifetime_budget), 10) : undefined,
          startTime: c.start_time != null ? String(c.start_time) : undefined,
          endTime: (c.stop_time ?? c.end_time) != null ? String(c.stop_time ?? c.end_time) : undefined,
          currency: currencyFor(acct),
          accountId: acct,
        });
      }

      for (const s of adsets as Record<string, unknown>[]) {
        const acct = String(s.account_id ?? accountId);
        objects.push({
          id: String(s.id ?? ""),
          level: "adset",
          name: String(s.name ?? ""),
          status: String(s.effective_status ?? ""),
          dailyBudgetMinor: s.daily_budget != null ? parseInt(String(s.daily_budget), 10) : undefined,
          lifetimeBudgetMinor: s.lifetime_budget != null ? parseInt(String(s.lifetime_budget), 10) : undefined,
          startTime: s.start_time != null ? String(s.start_time) : undefined,
          endTime: s.end_time != null ? String(s.end_time) : undefined,
          currency: currencyFor(acct),
          accountId: acct,
        });
      }

      for (const a of ads as Record<string, unknown>[]) {
        const acct = String(a.account_id ?? accountId);
        objects.push({
          id: String(a.id ?? ""),
          level: "ad",
          name: String(a.name ?? ""),
          status: String(a.effective_status ?? ""),
          currency: currencyFor(acct),
          accountId: acct,
        });
      }
    }

    return { objects };
  } catch (e) {
    return classifyMetaGraphError(ownerId, e);
  }
}
