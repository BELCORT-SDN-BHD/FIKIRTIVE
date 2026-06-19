"use server";
import { getCoworkThread, resolveCoworkResultUrls } from "./data";
import { toChatThreadDTO } from "./dto";
import type { ChatThreadDTO } from "./types";
import { requireOwner } from "./auth-guard";

export async function getCoworkThreadClient(threadId: string): Promise<ChatThreadDTO | null> {
  const owner = await requireOwner(); if ("error" in owner) throw new Error(owner.error);
  const { ownerId } = owner;
  const t = await getCoworkThread(ownerId, threadId);
  if (!t) return null;
  const urls = await resolveCoworkResultUrls(ownerId, [t]);
  return toChatThreadDTO(t, urls);
}
