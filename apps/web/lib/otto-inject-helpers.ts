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
import type { MetaActionStep } from "./meta-plan-card";
import type { StepResultStatus } from "./meta-write-actions";

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

/** The genJobIds that have a durable TURN_ERROR — so the card can show a failed state. */
export function errorJobIds(messages: OttoUiMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    const meta = m.metadata;
    if (meta?.kind === "TURN_ERROR" && meta.genJobId) ids.add(meta.genJobId);
  }
  return ids;
}

export type CardState = "idle" | "working" | "done" | "failed";

/** The plan card's lifecycle derived from durable data (never optimistic-only).
 *  Order matters: a terminal result/error always wins over "working". */
export function deriveCardState(args: {
  genJobId: string | null;
  submitted: boolean;
  results: Set<string>;
  errors: Set<string>;
}): CardState {
  const { genJobId, submitted, results, errors } = args;
  if (genJobId && errors.has(genJobId)) return "failed";
  if (genJobId && results.has(genJobId)) return "done";
  if (genJobId || submitted) return "working";
  return "idle";
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

/** The durable message kinds that render as an inline card widget. These (and
 *  only these) may be injected live mid-stream / backfilled by appendMissingCards.
 *  LOCKSTEP CONTRACT (seam 4): every live card kind must be here or the card is
 *  silently dropped until a page refresh — enforced by otto-card-seams.test.ts. */
export const CARD_KINDS = new Set(["GEN_CARD", "STORYBOARD_CARD", "ACTION_CARD", "BUILD_CARD", "PERFORMANCE_CARD", "RESEARCH_CARD"]);

/** Extract the persisted card id(s) from a `data-tool-propose` part's payload,
 *  tolerant of shape (F23): propose / propose-meta-action / propose-ad-build
 *  return { cardId }, proposePack returns { cardIds: [] }. A failed tool call
 *  returns neither (e.g. { message } only) → []. */
export function cardIdsOf(part: { type: string; data?: unknown }): string[] {
  if (part.type !== "data-tool-propose") return [];
  const data = part.data;
  if (!data || typeof data !== "object") return [];
  const { cardId, cardIds } = data as { cardId?: unknown; cardIds?: unknown };
  const ids: string[] = [];
  if (typeof cardId === "string" && cardId.length > 0) ids.push(cardId);
  if (Array.isArray(cardIds)) {
    for (const id of cardIds) {
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
  }
  return ids;
}

/**
 * Inject the durable card (GEN_CARD | STORYBOARD_CARD | ACTION_CARD | BUILD_CARD)
 * identified by `cardId` (from a freshly-streamed data-tool-propose) into the
 * useChat message list, so the just-proposed card appears inline with its FULL
 * payload. Deduped by durableId — if the card is already present (e.g. it was
 * seeded or a prior poll already added it) the list is returned unchanged
 * (same reference).
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
    (u) => u.metadata?.durableId === cardId && CARD_KINDS.has(u.metadata?.kind ?? ""),
  );
  if (!card) return messages;
  return [...messages, card];
}

/**
 * Safety net run at turn end (onFinish): append any card-kind durables
 * (GEN_CARD | ACTION_CARD | BUILD_CARD) present in the fresh thread but missing
 * from the useChat list, deduped by durableId. Covers a live data-tool-propose
 * part that was lost mid-stream. NEVER appends TEXT (the streamed reply already
 * rendered — re-adding would double it) or worker results (appendDurableResults
 * owns those). Returns the same array reference when nothing is missing.
 */
export function appendMissingCards(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
): OttoUiMessage[] {
  const present = new Set(
    messages.map((m) => m.metadata?.durableId).filter((id): id is string => !!id),
  );
  const additions = threadToUiMessages(fresh).filter((u) => {
    const meta = u.metadata;
    return !!meta && CARD_KINDS.has(meta.kind) && !present.has(meta.durableId);
  });
  if (additions.length === 0) return messages;
  return [...messages, ...additions];
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

export type ActionState = "pending" | "executing" | "done" | "partial" | "failed";

/**
 * Derive the display state of an ACTION_CARD's multi-step execution from its
 * MetaActionExecution rows. Mirrors the `aggregate` function inside
 * meta-write-actions.ts (which sets `RunResult.state`), extended to cover the
 * in-flight (APPLYING/PENDING) cases the durable RunResult never sees.
 *
 * - pending   — no executions have been created yet (plan not yet approved/auto-run).
 * - executing — at least one step is APPLYING (in-flight) or PENDING (queued).
 * - done      — every step resolved as APPLIED or SKIPPED.
 * - partial   — at least one APPLIED/SKIPPED AND at least one FAILED/DIVERGED/NEEDS_CONFIRM.
 * - failed    — no APPLIED/SKIPPED at all, and at least one terminal non-ok status.
 */
export function deriveActionState(
  steps: MetaActionStep[],
  executions: Array<{ stepIndex: number; status: string }>,
): ActionState {
  if (executions.length === 0) return "pending";

  const statuses = executions.map((e) => e.status as StepResultStatus | "APPLYING" | "PENDING");

  const anyExecuting = statuses.some((s) => s === "APPLYING" || s === "PENDING");
  if (anyExecuting) return "executing";

  const anyOk = statuses.some((s) => s === "APPLIED" || s === "SKIPPED");
  const allOk = statuses.every((s) => s === "APPLIED" || s === "SKIPPED") &&
    statuses.length === steps.length;

  if (allOk) return "done";
  if (anyOk) return "partial";
  return "failed";
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

/**
 * Append completed research reports after a RESEARCH_CARD's status poll observes
 * `done`. Research reports are async worker output too, but they are intentionally
 * separate from appendDurableResults so the generation poll keeps its narrow
 * GEN_RESULT / TURN_ERROR contract.
 */
export function appendResearchReports(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
): OttoUiMessage[] {
  const present = new Set(
    messages.map((m) => m.metadata?.durableId).filter((id): id is string => !!id),
  );
  const additions = threadToUiMessages(fresh).filter((u) => {
    const meta = u.metadata;
    return meta?.kind === "RESEARCH_REPORT" && !present.has(meta.durableId);
  });
  if (additions.length === 0) return messages;
  return [...messages, ...additions];
}
