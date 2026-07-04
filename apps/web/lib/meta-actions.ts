"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { encryptToken, decryptToken } from "./token-encryption";
import { exchangeCodeForToken, metaGraphGet } from "./meta-graph";
import { fetchOwnerInsights, type AccountInsights } from "./meta-insights";

export type MetaAdAccount = { id: string; name: string; currency: string; status: string };

/** Enforces auth itself; NEVER accept ownerId from the caller. */
export async function completeMetaConnect(
  code: string,
  redirectUri: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const ex = await exchangeCodeForToken(code, redirectUri);
  if ("error" in ex) return ex;
  const enc = encryptToken(ex.token);
  const canWrite = ex.grantedScopes.includes("ads_management");
  const canManagePages = ex.grantedScopes.includes("pages_show_list");
  const scope = ex.grantedScopes.length > 0 ? ex.grantedScopes.join(",") : "";
  const data = { accessTokenEnc: enc, tokenExpiresAt: ex.expiresAt, scope, canWrite, canManagePages, status: "active" as const, metaUserId: ex.metaUserId };
  await prisma.metaConnection.upsert({
    where: { ownerId: gate.ownerId },
    update: data,
    create: { id: newId(), ownerId: gate.ownerId, adsAutonomy: "ASK" as const, defaultPageId: null, ...data },
  });
  return { ok: true };
}

/** Read-only: the owner's connected ad accounts via their decrypted token. Never returns the token.
 *  F37: only a REAL token failure (Meta code 190/102) reports needsReconnect; any other thrown
 *  error (network blip, Graph 5xx, rate limit — code 4/17/32 are type OAuthException too, so we
 *  branch on code, not type) is transientError so the UI offers a retry, not a redundant OAuth. */
async function getMyAdAccounts(
  ownerId: string,
): Promise<{ accounts: MetaAdAccount[] } | { needsReconnect: true } | { transientError: true }> {
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { needsReconnect: true };
  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { needsReconnect: true };
  }
  try {
    const j = await metaGraphGet(token, "me/adaccounts", { fields: "name,account_status,currency,account_id" });
    const accounts: MetaAdAccount[] = (j.data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.account_id ?? a.id ?? ""),
      name: String(a.name ?? ""),
      currency: String(a.currency ?? ""),
      status: String(a.account_status ?? ""),
    }));
    return { accounts };
  } catch (e) {
    const code = (e as { metaError?: { code?: number } })?.metaError?.code;
    if (code === 190 || code === 102) {
      if (code === 190) {
        await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
      }
      return { needsReconnect: true };
    }
    return { transientError: true };
  }
}

export async function getMetaConnection(): Promise<
  | { connected: boolean; status?: string; adsAutonomy?: string; canWrite?: boolean; adsWritesPaused?: boolean; canManagePages?: boolean; defaultPageId?: string | null; accounts?: MetaAdAccount[]; needsReconnect?: boolean; transientError?: boolean }
  | { error: string }
> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const conn = await prisma.metaConnection.findUnique({
    where: { ownerId: gate.ownerId },
    select: { status: true, adsAutonomy: true, canWrite: true, adsWritesPaused: true, canManagePages: true, defaultPageId: true },
  });
  if (!conn) return { connected: false };
  const res = await getMyAdAccounts(gate.ownerId);
  // F37: transient failure — report the REAL stored status (the token is fine) so the
  // UI shows "couldn't reach Meta — retry" instead of a false reconnect scare.
  if ("transientError" in res) return { connected: true, status: conn.status, transientError: true, adsAutonomy: conn.adsAutonomy ?? "ASK", canWrite: conn.canWrite ?? false, adsWritesPaused: conn.adsWritesPaused ?? false, canManagePages: conn.canManagePages ?? false, defaultPageId: conn.defaultPageId ?? null };
  if ("needsReconnect" in res) return { connected: true, status: "expired", needsReconnect: true, adsAutonomy: conn.adsAutonomy ?? "ASK", canWrite: conn.canWrite ?? false, adsWritesPaused: conn.adsWritesPaused ?? false, canManagePages: conn.canManagePages ?? false, defaultPageId: conn.defaultPageId ?? null };
  return {
    connected: true,
    status: conn.status,
    adsAutonomy: conn.adsAutonomy,
    canWrite: conn.canWrite,
    adsWritesPaused: conn.adsWritesPaused,
    canManagePages: conn.canManagePages,
    defaultPageId: conn.defaultPageId,
    accounts: res.accounts,
  };
}

export async function disconnectMeta(): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  await prisma.metaConnection.deleteMany({ where: { ownerId: gate.ownerId } });
  return { ok: true };
}

export async function getMetaInsights(
  datePreset?: string,
): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return fetchOwnerInsights(gate.ownerId, datePreset ?? "last_30d");
}
