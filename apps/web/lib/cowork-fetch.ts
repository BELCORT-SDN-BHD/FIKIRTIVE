"use server";
import { getCoworkThread, resolveCoworkResultUrls } from "./data";
import { toChatThreadDTO } from "./dto";
import type { ChatThreadDTO } from "./types";

export async function getCoworkThreadClient(threadId: string): Promise<ChatThreadDTO | null> {
  const t = await getCoworkThread(threadId);
  if (!t) return null;
  const urls = await resolveCoworkResultUrls([t]);
  return toChatThreadDTO(t, urls);
}
