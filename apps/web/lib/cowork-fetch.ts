"use server";
import { getCoworkThreadPage, resolveCoworkResultUrls } from "./data";
import { toChatThreadDTO } from "./dto";
import type { ChatThreadDTO } from "./types";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";

export async function getCoworkThreadClient(threadId: string): Promise<ChatThreadDTO | null> {
  const owner = await requireOwner(); if ("error" in owner) throw new Error(owner.error);
  const { ownerId } = owner;
  const principal = await resolveUserPrincipal(owner);
  return runAsUser(principal, async () => {
    const t = await getCoworkThreadPage(ownerId, threadId);
    if (!t) return null;
    const urls = await resolveCoworkResultUrls(ownerId, [t]);
    return { ...toChatThreadDTO(t, urls), hasOlderMessages: t.hasOlderMessages };
  });
}

export async function getOlderCoworkThreadMessagesClient(
  threadId: string,
  beforeSeq: number,
): Promise<ChatThreadDTO | null> {
  const owner = await requireOwner(); if ("error" in owner) throw new Error(owner.error);
  const { ownerId } = owner;
  const principal = await resolveUserPrincipal(owner);
  return runAsUser(principal, async () => {
    const t = await getCoworkThreadPage(ownerId, threadId, beforeSeq);
    if (!t) return null;
    const urls = await resolveCoworkResultUrls(ownerId, [t]);
    return { ...toChatThreadDTO(t, urls), hasOlderMessages: t.hasOlderMessages };
  });
}
