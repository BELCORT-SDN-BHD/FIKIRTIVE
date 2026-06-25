/**
 * otto-inject-helpers — PURE helpers for OttoChatStream's inline-widget wiring
 * (Task 5). They operate on the OttoUiMessage[] useChat renders (each non-TEXT
 * message carries { durableId, kind, payload, genJobId } in metadata) and on the
 * durable ChatThreadDTO the bounded poll refetches.
 *
 * Pure (no React, no I/O) so they are unit-testable in the node harness, mirroring
 * otto-ui-messages.ts / otto-status-helpers.ts.
 *
 * Two facts shape these helpers (see task-5 brief):
 *   1. The live `data-tool-propose` stream part carries ONLY { cardId, … } — not
 *      enough to render the card. The FULL GEN_CARD payload lives in the durable
 *      thread; injectCardMessage builds the UI-message from that durable message.
 *   2. The async generation result NEVER comes through the stream. It lands as a
 *      durable GEN_RESULT / TURN_ERROR seconds-to-minutes later, surfaced by the
 *      bounded poll and appended via appendDurableResults.
 */
import type { OttoUiMessage } from "./otto-ui-messages";
import { threadToUiMessages } from "./otto-ui-messages";
import type { ChatThreadDTO } from "./types";

/** The genJobIds that already have a durable GEN_RESULT — so we never double-render
 *  a result for a job whose card also shows "✓ making this now". */
export function resultJobIds(messages: OttoUiMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    const meta = m.metadata;
    if (meta?.kind === "GEN_RESULT" && meta.genJobId) ids.add(meta.genJobId);
  }
  return ids;
}

/** A job is "working" once its GEN_CARD has a genJobId (it was approved/generated)
 *  but no terminal message (GEN_RESULT or TURN_ERROR) has landed for that job yet.
 *  While any job is working the component polls the durable thread for the result. */
export function hasWorkingJob(messages: OttoUiMessage[]): boolean {
  const terminal = new Set<string>();
  for (const m of messages) {
    const meta = m.metadata;
    if ((meta?.kind === "GEN_RESULT" || meta?.kind === "TURN_ERROR") && meta.genJobId) {
      terminal.add(meta.genJobId);
    }
  }
  return messages.some((m) => {
    const meta = m.metadata;
    return meta?.kind === "GEN_CARD" && !!meta.genJobId && !terminal.has(meta.genJobId);
  });
}

/** Extract the proposed card id from a `data-tool-propose` part's payload
 *  ({ cardId, shownPriceDisplay }), tolerant of shape. Returns null if absent. */
export function proposeCardId(part: { type: string; data?: unknown }): string | null {
  if (part.type !== "data-tool-propose") return null;
  const data = part.data;
  if (!data || typeof data !== "object") return null;
  const cardId = (data as { cardId?: unknown }).cardId;
  return typeof cardId === "string" && cardId.length > 0 ? cardId : null;
}

/**
 * Inject the durable GEN_CARD identified by `cardId` (from a freshly-streamed
 * data-tool-propose) into the useChat message list, so the just-proposed card
 * appears inline with its FULL payload. Deduped by durableId — if the card is
 * already present (e.g. it was seeded or a prior poll already added it) the list
 * is returned unchanged (same reference).
 *
 * Returns the new messages array (or the same array if nothing changed).
 */
export function injectCardMessage(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
  cardId: string,
): OttoUiMessage[] {
  if (messages.some((m) => m.metadata?.durableId === cardId)) return messages;
  const card = threadToUiMessages(fresh).find(
    (u) => u.metadata?.durableId === cardId && u.metadata?.kind === "GEN_CARD",
  );
  if (!card) return messages;
  return [...messages, card];
}

/** Patch in-memory GEN_CARD genJobIds from the durable thread. After "Make it",
 *  coworkGenerate sets genJobId on the durable GEN_CARD; without this the in-memory
 *  copy keeps genJobId=null, hasWorkingJob never flips true, and the result poll
 *  never arms. Returns a NEW array only if something changed (else the same ref). */
export function syncCardJobIds(messages: OttoUiMessage[], fresh: ChatThreadDTO): OttoUiMessage[] {
  // Build a map of durableId → genJobId for GEN_CARDs in the fresh durable thread.
  const freshJobIds = new Map<string, string | null>();
  for (const u of threadToUiMessages(fresh)) {
    if (u.metadata?.kind === "GEN_CARD") {
      freshJobIds.set(u.metadata.durableId, u.metadata.genJobId);
    }
  }

  let changed = false;
  const patched = messages.map((m) => {
    const meta = m.metadata;
    if (meta?.kind !== "GEN_CARD") return m;
    const freshJobId = freshJobIds.get(meta.durableId);
    // Only patch when the durable thread has a non-null genJobId that differs from in-memory.
    if (!freshJobId || freshJobId === meta.genJobId) return m;
    changed = true;
    return { ...m, metadata: { ...meta, genJobId: freshJobId } };
  });

  return changed ? patched : messages;
}

/**
 * Append worker-output durable messages (GEN_RESULT / TURN_ERROR ONLY) from the
 * polled thread that are not already present in the useChat list, deduped by
 * durableId. NEVER appends TEXT or GEN_CARD: those already arrived via the live
 * stream (streamed reply) or via injectCardMessage — re-injecting them would
 * duplicate the streamed turn. DENIAL is also excluded (it's a terminal TEXT-like
 * message emitted inline by the route stream, not async worker output).
 *
 * Returns the new messages array (or the same array if nothing new landed).
 */
export function appendDurableResults(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
): OttoUiMessage[] {
  const present = new Set(
    messages.map((m) => m.metadata?.durableId).filter((id): id is string => !!id),
  );
  const additions = threadToUiMessages(fresh).filter((u) => {
    const meta = u.metadata;
    if (!meta) return false;
    if (meta.kind !== "GEN_RESULT" && meta.kind !== "TURN_ERROR") return false;
    return !present.has(meta.durableId);
  });
  if (additions.length === 0) return messages;
  return [...messages, ...additions];
}
