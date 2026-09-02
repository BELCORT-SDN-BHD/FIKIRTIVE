import "server-only";
import { storageKey, coworkProposalSchema } from "@fikirtive/core";
import { storage, kindOf } from "./storage";
import { sanitizeUserError } from "./provider-secrecy";
import type { EntityWithRefs, ChatThreadWithMessages } from "./data";
import type { EntityDTO, ChatMessageDTO, ChatThreadDTO } from "./types";

type EntityWithOttoUsage = EntityWithRefs & { _ottoUsageCount?: number };
type ChatThreadDTOInput = Pick<
  ChatThreadWithMessages,
  "id" | "projectId" | "title" | "updatedAt" | "pinnedAt" | "messages"
>;

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
    if (proposal.success) {
      const {
        model: _model,
        params: _params,
        reason: _reason,
        ...publicPayload
      } = p;
      payload = { ...publicPayload, ...proposal.data };
    }
  } else if (m.kind === "GEN_RESULT") {
    const p = (m.payload ?? {}) as { kind?: string; costCredits?: number };
    const resolved = m.genJobId ? urlsByJob.get(m.genJobId) : undefined;
    // kind is always written by the worker (gen.ts); a missing/invalid value signals payload
    // corruption — surface it instead of silently coercing (e.g. a video result → "image").
    const kind: "image" | "video" = p.kind === "video" || p.kind === "image" ? p.kind : "image";
    if (p.kind !== "image" && p.kind !== "video") {
      console.warn(`dto GEN_RESULT: invalid kind=${JSON.stringify(p.kind)} genJobId=${m.genJobId ?? "?"} → defaulting to image`);
    }
    payload = {
      kind,
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
    const autoOutcome = (p.autoOutcome ?? null) as Record<string, unknown> | null;
    payload = {
      ...p,
      ...(approval
        ? { approval: { expiresAt: approval.expiresAt, consumedAt: approval.consumedAt } }
        : {}),
      ...(autoOutcome && typeof autoOutcome.reason === "string"
        ? { autoOutcome: { ...autoOutcome, reason: sanitizeUserError(autoOutcome.reason) } }
        : {}),
    };
  } else if (m.kind === "BUILD_CARD" && m.payload) {
    // Mirror of the ACTION_CARD arm: strip approval.boundActor + paramHash (internal server fields)
    // so the client never receives them. Keep approval.expiresAt|consumedAt for display, all
    // display fields (planTitle, etc.), and buildOutcome for card state rendering.
    const p = m.payload as Record<string, unknown>;
    const approval = (p.approval ?? null) as Record<string, unknown> | null;
    const buildOutcome = (p.buildOutcome ?? null) as Record<string, unknown> | null;
    payload = {
      ...p,
      ...(approval
        ? { approval: { expiresAt: approval.expiresAt, consumedAt: approval.consumedAt } }
        : {}),
      ...(buildOutcome && typeof buildOutcome.reason === "string"
        ? { buildOutcome: { ...buildOutcome, reason: sanitizeUserError(buildOutcome.reason) } }
        : {}),
    };
  } else if (m.kind === "TURN_ERROR" && m.payload) {
    // Rehydrate only the client-facing failure contract. Internal refId/errorId
    // fields stay server-side; the renderer needs the exact kind/text plus the
    // triggering USER id to restore the existing retry affordance.
    const p = m.payload as Record<string, unknown>;
    const error = p.error as Record<string, unknown> | undefined;
    // A MERCHANT'S OWN CANCEL COMES FIRST (#602 r2, cross-family judge P1-1).
    //
    // A job's terminal thread message is a TURN_ERROR whatever ended it — that kind owns the
    // one-terminal-message-per-job unique index, so a cancel cannot have a kind of its own. The
    // durable row therefore carries `{ cancelled: true }`, and THIS mapping is the only thing
    // between it and the card. Without this arm the whitelist above dropped the marker (a cancel
    // payload has no `error`), so `payload` came back null, the card re-derived `failed` on every
    // reload, and the merchant was shown a red apology and a "Try again" button for work they
    // chose to stop. Writing the marker was never the hard part — carrying it was.
    if (p.cancelled === true) {
      payload = { kind: "cancelled", cancelled: true };
    } else if (
      (error?.kind === "insufficient_credits" || error?.kind === "spend_cap" || error?.kind === "error")
      && typeof error.text === "string"
    ) {
      payload = {
        kind: "stream_run_error",
        ...(typeof p.userMessageId === "string" ? { userMessageId: p.userMessageId } : {}),
        error: { kind: error.kind, text: sanitizeUserError(error.text) },
      };
    }
  } else if (m.kind === "STORYBOARD_CARD" && m.payload) {
    // Pass the storyboard payload through so the STORYBOARD_CARD render branch has
    // shots to draw — both on reload and on live mid-turn inject. No spend/approval
    // internals live on it ($0 card); parseStoryboardCardPayload defends the shape client-side.
    payload = m.payload;
  } else if ((m.kind === "RESEARCH_CARD" || m.kind === "RESEARCH_REPORT") && m.payload) {
    // Pass the research payload through so the render branch has the plan/report to draw.
    // No spend/approval internals live on the $0 RESEARCH_CARD (approve→reserve is S3);
    // parseResearchCardPayload defends the shape client-side.
    const p = m.payload as Record<string, unknown>;
    payload = {
      ...p,
      ...(typeof p.error === "string" ? { error: sanitizeUserError(p.error) } : {}),
    };
  } else if (m.kind === "PERFORMANCE_CARD" && m.payload) {
    // Pass the diagnosis payload through so the PERFORMANCE_CARD render branch has the per-ad
    // verdicts to draw — both on reload and on live mid-turn inject. $0 card, no spend/approval
    // internals; PerformanceCard defends the shape client-side. (Without this the reload/DTO path
    // hands the card a null payload and it renders empty.)
    payload = m.payload;
  }
  return {
    id: m.id,
    role: m.role as "USER" | "AGENT",
    // No cast: the row's `kind` IS the DTO's kind (ChatMessageDTO derives it from the schema
    // enum). The cast that stood here named twelve of the fourteen members and, being a cast,
    // could not complain about the two it had fallen behind on — an APPROVAL_CARD row was typed
    // here as something it is not, silently, for as long as the list stayed stale.
    kind: m.kind,
    seq: m.seq,
    text: m.text,
    payload,
    genJobId: m.genJobId,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toChatThreadDTO(t: ChatThreadDTOInput, urlsByJob: Map<string, { urls: string[]; generationIds: string[]; spentUsd: number | null }>): ChatThreadDTO {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    updatedAt: t.updatedAt.toISOString(),
    pinnedAt: t.pinnedAt ? t.pinnedAt.toISOString() : null,
    messages: t.messages.map((m) => toChatMessageDTO(m, urlsByJob)),
  };
}

/** Thread-LIST DTO: metadata only, empty messages. The rail renders title + time; the
 *  active thread's messages lazy-load via getCoworkThreadClient. (scale audit 2026-06-20) */
export function toChatThreadMetaDTO(t: { id: string; projectId: string; title: string; updatedAt: Date; pinnedAt?: Date | null; _badge?: "working" | "failed" | "done" | null }): ChatThreadDTO {
  return { id: t.id, projectId: t.projectId, title: t.title, updatedAt: t.updatedAt.toISOString(), pinnedAt: t.pinnedAt ? t.pinnedAt.toISOString() : null, messages: [], status: t._badge ?? null };
}
