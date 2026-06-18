"use server";
import { getCoworkThread, resolveCoworkResultUrls } from "./data";
import { toChatThreadDTO } from "./dto";
import type { ChatThreadDTO } from "./types";
import { requireSession } from "./auth-guard";

export async function getCoworkThreadClient(threadId: string): Promise<ChatThreadDTO | null> {
  const gate = await requireSession(); if ("error" in gate) throw new Error(gate.error);
  const t = await getCoworkThread(threadId);
  if (!t) return null;
  const urls = await resolveCoworkResultUrls([t]);
  return toChatThreadDTO(t, urls);
}
