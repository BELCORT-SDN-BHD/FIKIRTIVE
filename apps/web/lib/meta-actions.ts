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
  const data = { accessTokenEnc: enc, tokenExpiresAt: ex.expiresAt, scope: "ads_read", status: "active" };
  await prisma.metaConnection.upsert({
    where: { ownerId: gate.ownerId },
    update: data,
    create: { id: newId(), ownerId: gate.ownerId, ...data },
  });
  return { ok: true };
}

/** Read-only: the owner's connected ad accounts via their decrypted token. Never returns the token. */
async function getMyAdAccounts(ownerId: string): Promise<{ accounts: MetaAdAccount[] } | { needsReconnect: true }> {
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
    if (code === 190) {
      await prisma.metaConnection.update({ where: { ownerId }, data: { status: "expired" } }).catch(() => {});
    }
    return { needsReconnect: true };
  }
}

export async function getMetaConnection(): Promise<
  { connected: boolean; status?: string; accounts?: MetaAdAccount[]; needsReconnect?: boolean } | { error: string }
> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId: gate.ownerId }, select: { status: true } });
  if (!conn) return { connected: false };
  const res = await getMyAdAccounts(gate.ownerId);
  if ("needsReconnect" in res) return { connected: true, status: "expired", needsReconnect: true };
  return { connected: true, status: conn.status, accounts: res.accounts };
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
