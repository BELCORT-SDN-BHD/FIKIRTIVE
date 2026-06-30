"use server";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { revalidatePath } from "next/cache";
import { type OwnerSettings, DEFAULT_SETTINGS, mergeSettings } from "./owner-settings";

export async function getOwnerSettings(): Promise<OwnerSettings | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const org = await prisma.organization.findUnique({
    where: { id: gate.ownerId },
    select: { settings: true },
  });
  return mergeSettings(org?.settings ?? null);
}

export async function setOwnerSetting<K extends keyof OwnerSettings>(
  key: K,
  value: OwnerSettings[K],
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(key in DEFAULT_SETTINGS)) return { error: "Unknown setting." };
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) return { error: "Bad value." };
  const org = await prisma.organization.findUnique({
    where: { id: gate.ownerId },
    select: { settings: true },
  });
  const next = { ...mergeSettings(org?.settings ?? null), [key]: value };
  try {
    await prisma.organization.update({ where: { id: gate.ownerId }, data: { settings: next } });
  } catch {
    return { error: "Failed to save setting." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
