import "server-only";
import { storageKey, coworkProposalSchema } from "@artlio/core";
import { storage, kindOf } from "./storage";
import type { EntityWithRefs, ChatThreadWithMessages } from "./data";
import type { EntityDTO, ChatMessageDTO, ChatThreadDTO } from "./types";

export function assetUrl(ownerId: string, contentHash: string, ext: string) {
  return storage.url(storageKey(ownerId, contentHash, ext));
}

/** A reference image row (with its joined asset) → RefImageDTO. */
function refOf(r: { id: string; assetId: string; asset: { ownerId: string; contentHash: string; ext: string } }) {
  return {
    id: r.id,
    assetId: r.assetId,
    url: assetUrl(r.asset.ownerId, r.asset.contentHash, r.asset.ext),
    kind: kindOf(r.asset.ext),
  };
}

/** Shared Entity → DTO mapping (workbench + library render the same store). */
export function toEntityDTO(e: EntityWithRefs): EntityDTO {
  return {
    id: e.id,
    type: e.type,
    name: e.name,
    aliases: e.aliases,
    notes: e.notes,
    negativeConstraints: e.negativeConstraints,
    refs: e.referenceImages.map(refOf),
    baseAssetId: e.baseAssetId,
    variants: e.variants.map((v) => ({
      id: v.id,
      name: v.name,
      handle: v.handle,
      prompt: v.prompt,
      refs: v.referenceImages.map(refOf),
    })),
    usageCount: e._count.shotRefs,
  };
}

export function toChatMessageDTO(
  m: ChatThreadWithMessages["messages"][number],
  urlsByJob: Map<string, { urls: string[]; generationIds: string[]; spentUsd: number | null }>,
): ChatMessageDTO {
  let payload: unknown | null = null;
  if (m.kind === "GEN_CARD" && m.payload) {
    const p = m.payload as Record<string, unknown>;
    const proposal = coworkProposalSchema.safeParse({
      kind: p.kind,
      desiredAspect: p.desiredAspect,
      desiredDuration: p.desiredDuration,
      desiredAudio: p.desiredAudio,
      structuredPrompt: p.structuredPrompt,
      entityIds: p.entityIds ?? [],
      variantSel: p.variantSel ?? {},
    });
    // malformed → render as plain text (no card)
    payload = proposal.success ? { ...p, ...proposal.data } : null;
  } else if (m.kind === "GEN_RESULT") {
    const p = (m.payload ?? {}) as { kind?: string; model?: string };
    const resolved = m.genJobId ? urlsByJob.get(m.genJobId) : undefined;
    payload = {
      kind: p.kind ?? "image",
      model: p.model ?? "",
      urls: resolved?.urls ?? [],
      generationIds: resolved?.generationIds ?? [], // "Animate this result" → i2v source-frame
      // the real metered charge (frozen ledger value) so the caption shows what was actually
      // billed; null for legacy/failed jobs → the UI falls back to a default-config estimate.
      ...(typeof resolved?.spentUsd === "number" ? { costUsd: resolved.spentUsd } : {}),
    };
  } else if (m.kind === "PLAN" && m.payload) {
    payload = m.payload; // { planSteps }
  }
  return {
    id: m.id,
    role: m.role as "USER" | "AGENT",
    kind: m.kind as "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR",
    seq: m.seq,
    text: m.text,
    payload,
    genJobId: m.genJobId,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toChatThreadDTO(t: ChatThreadWithMessages, urlsByJob: Map<string, { urls: string[]; generationIds: string[]; spentUsd: number | null }>): ChatThreadDTO {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    updatedAt: t.updatedAt.toISOString(),
    messages: t.messages.map((m) => toChatMessageDTO(m, urlsByJob)),
  };
}
