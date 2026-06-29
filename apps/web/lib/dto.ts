import "server-only";
import { storageKey, coworkProposalSchema } from "@fikirtive/core";
import { storage, kindOf } from "./storage";
import type { EntityWithRefs, ChatThreadWithMessages } from "./data";
import type { EntityDTO, ChatMessageDTO, ChatThreadDTO } from "./types";

type EntityWithOttoUsage = EntityWithRefs & { _ottoUsageCount?: number };

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
export function toEntityDTO(e: EntityWithOttoUsage): EntityDTO {
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
    usageCount: e._count.shotRefs + (e._ottoUsageCount ?? 0),
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
    const p = (m.payload ?? {}) as { kind?: string; model?: string; costCredits?: number };
    const resolved = m.genJobId ? urlsByJob.get(m.genJobId) : undefined;
    // kind is always written by the worker (gen.ts); a missing/invalid value signals payload
    // corruption — surface it instead of silently coercing (e.g. a video result → "image").
    const kind: "image" | "video" = p.kind === "video" || p.kind === "image" ? p.kind : "image";
    if (p.kind !== "image" && p.kind !== "video") {
      console.warn(`dto GEN_RESULT: invalid kind=${JSON.stringify(p.kind)} genJobId=${m.genJobId ?? "?"} → defaulting to image`);
    }
    payload = {
      kind,
      model: p.model ?? "",
      urls: resolved?.urls ?? [],
      generationIds: resolved?.generationIds ?? [], // "Animate this result" → i2v source-frame
      // the real metered charge (frozen ledger value) so the caption shows what was actually
      // billed; null for legacy/failed jobs → the UI falls back to a default-config estimate.
      ...(typeof resolved?.spentUsd === "number" ? { costUsd: resolved.spentUsd } : {}),
      // Forward the worker-written costCredits (the real charged credits, stored on the
      // GEN_RESULT payload by appendCoworkResult) so OttoResult can show "Cost: N credits".
      // Without this the #30 cost line is dead on arrival.
      ...(typeof p.costCredits === "number" ? { costCredits: p.costCredits } : {}),
    };
  } else if (m.kind === "PLAN" && m.payload) {
    payload = m.payload; // { planSteps }
  } else if (m.kind === "ACTION_CARD" && m.payload) {
    // FIX G: send a CLIENT-SAFE payload — strip approval internals (boundActor = internal ownerId,
    // and paramHash) that the browser never needs. The card only renders planTitle/steps/spend/
    // autoEligible/autoOutcome, plus approval.expiresAt|consumedAt for display. The server-side
    // payload in the DB stays intact; only this DTO sent to the client is stripped.
    const p = m.payload as Record<string, unknown>;
    const approval = (p.approval ?? null) as Record<string, unknown> | null;
    payload = {
      ...p,
      ...(approval
        ? { approval: { expiresAt: approval.expiresAt, consumedAt: approval.consumedAt } }
        : {}),
    };
  } else if (m.kind === "BUILD_CARD" && m.payload) {
    // Mirror of the ACTION_CARD arm: strip approval.boundActor + paramHash (internal server fields)
    // so the client never receives them. Keep approval.expiresAt|consumedAt for display, all
    // display fields (planTitle, etc.), and buildOutcome for card state rendering.
    const p = m.payload as Record<string, unknown>;
    const approval = (p.approval ?? null) as Record<string, unknown> | null;
    payload = {
      ...p,
      ...(approval
        ? { approval: { expiresAt: approval.expiresAt, consumedAt: approval.consumedAt } }
        : {}),
    };
  }
  return {
    id: m.id,
    role: m.role as "USER" | "AGENT",
    kind: m.kind as "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR" | "ACTION_CARD" | "BUILD_CARD",
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

/** Thread-LIST DTO: metadata only, empty messages. The rail renders title + time; the
 *  active thread's messages lazy-load via getCoworkThreadClient. (scale audit 2026-06-20) */
export function toChatThreadMetaDTO(t: { id: string; projectId: string; title: string; updatedAt: Date; _badge?: "working" | "failed" | "done" | null }): ChatThreadDTO {
  return { id: t.id, projectId: t.projectId, title: t.title, updatedAt: t.updatedAt.toISOString(), messages: [], status: t._badge ?? null };
}
