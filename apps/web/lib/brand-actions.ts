"use server";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type BrandKitDTO = {
  id: string;
  brandId: string | null;
  name: string | null;
  colorsJson: unknown; // freeform JSON — callers cast as needed
  fonts: string[];
  tone: string | null;
  styleGuide: string | null;
  logoAssetId: string | null;
  updatedAt: Date;
};

export type BrandRuleDTO = {
  id: string;
  brandId: string | null;
  kind: string;
  text: string;
  active: boolean;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// BrandKit
// ---------------------------------------------------------------------------

/** Return the owner's BrandKit for the given brandId (null = personal). Returns
 *  null when no kit has been saved yet. */
export async function getBrandKit(
  brandId?: string | null,
): Promise<BrandKitDTO | null | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const kit = await prisma.brandKit.findFirst({
    where: { ownerId, brandId: brandId ?? null },
    select: {
      id: true,
      brandId: true,
      name: true,
      colorsJson: true,
      fonts: true,
      tone: true,
      styleGuide: true,
      logoAssetId: true,
      updatedAt: true,
    },
  });
  return kit as BrandKitDTO | null;
}

export type SaveBrandKitInput = {
  brandId?: string | null;
  name?: string | null;
  colorsJson?: unknown;
  fonts?: string[];
  tone?: string | null;
  styleGuide?: string | null;
  logoAssetId?: string | null;
};

/** Upsert a BrandKit for the owner + brandId. Returns the kit id. */
export async function saveBrandKit(
  input: SaveBrandKitInput,
): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const brandId = input.brandId ?? null;
  try {
    const existing = await prisma.brandKit.findFirst({
      where: { ownerId, brandId },
      select: { id: true },
    });

    const data = {
      name: typeof input.name === "string" ? input.name.trim().slice(0, 200) : undefined,
      colorsJson: input.colorsJson !== undefined ? (input.colorsJson as object) : undefined,
      fonts: Array.isArray(input.fonts) ? input.fonts.map((f) => String(f).trim()).filter(Boolean) : undefined,
      tone: typeof input.tone === "string" ? input.tone.trim().slice(0, 500) : (input.tone === null ? null : undefined),
      styleGuide: typeof input.styleGuide === "string" ? input.styleGuide.trim().slice(0, 5000) : (input.styleGuide === null ? null : undefined),
      logoAssetId: typeof input.logoAssetId === "string" ? input.logoAssetId : (input.logoAssetId === null ? null : undefined),
    } as Record<string, unknown>;

    // Strip undefined keys so Prisma doesn't try to write them
    for (const k of Object.keys(data)) {
      if (data[k] === undefined) delete data[k];
    }

    if (existing) {
      await prisma.brandKit.update({
        where: { id: existing.id },
        data,
      });
      return { id: existing.id };
    } else {
      const id = newId();
      await prisma.brandKit.create({
        data: { id, ownerId, brandId, ...data },
      });
      return { id };
    }
  } catch {
    return { error: "Couldn't save brand kit — please try again." };
  }
}

// ---------------------------------------------------------------------------
// BrandRule
// ---------------------------------------------------------------------------

/** List active (or all) BrandRules for the owner + brandId. */
export async function listBrandRules(
  brandId?: string | null,
): Promise<BrandRuleDTO[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const rows = await prisma.brandRule.findMany({
    where: { ownerId, brandId: brandId ?? null },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    select: { id: true, brandId: true, kind: true, text: true, active: true, createdAt: true },
  });
  return rows as BrandRuleDTO[];
}

export type AddBrandRuleInput = {
  kind: string;
  text: string;
  brandId?: string | null;
};

/** Add a new BrandRule. kind must be one of always|never|tone|color. */
export async function addBrandRule(
  input: AddBrandRuleInput,
): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const VALID_KINDS = ["always", "never", "tone", "color"] as const;
  const kind = typeof input.kind === "string" ? input.kind : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!VALID_KINDS.includes(kind as (typeof VALID_KINDS)[number])) {
    return { error: `kind must be one of: ${VALID_KINDS.join(", ")}` };
  }
  if (!text) return { error: "Rule text cannot be empty." };

  try {
    const id = newId();
    await prisma.brandRule.create({
      data: {
        id,
        ownerId,
        brandId: input.brandId ?? null,
        kind,
        text: text.slice(0, 2000),
        active: true,
      },
    });
    return { id };
  } catch {
    return { error: "Couldn't add rule — please try again." };
  }
}

/** Set a BrandRule's active flag. Only updates rules owned by the session owner. */
export async function setBrandRuleActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    const { count } = await prisma.brandRule.updateMany({
      where: { id, ownerId },
      data: { active },
    });
    if (!count) return { error: "Rule not found." };
    return { ok: true };
  } catch {
    return { error: "Couldn't update rule — please try again." };
  }
}

/** Delete a BrandRule. Only deletes rules owned by the session owner. */
export async function deleteBrandRule(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    const { count } = await prisma.brandRule.deleteMany({
      where: { id, ownerId },
    });
    if (!count) return { error: "Rule not found." };
    return { ok: true };
  } catch {
    return { error: "Couldn't delete rule — please try again." };
  }
}
