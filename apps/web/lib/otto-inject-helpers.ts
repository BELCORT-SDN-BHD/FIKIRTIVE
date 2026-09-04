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
import { latestAssistantSayable } from "./otto-canvas-turn";

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

/** Is this durable TURN_ERROR payload the mark a merchant's own cancel leaves (#602 T3)? */
export function cancelledTurnPayload(payload: unknown): boolean {
  return !!payload && typeof payload === "object" && (payload as { cancelled?: unknown }).cancelled === true;
}

/**
 * The genJobIds whose terminal message says the MERCHANT stopped it (#602 T3 · spec #599 D4).
 *
 * A job's terminal thread message is a TURN_ERROR whatever ended it — that kind carries the
 * per-job unique index, so cancelling cannot get a kind of its own without making two terminal
 * messages possible. Every cancel therefore read as a failure: after a reload the plan card went
 * red, said "This one didn't come through", and offered "Try again" for work the merchant chose
 * to stop. `cancelGenJob` marks its message; this is the reader of that mark.
 */
export function cancelledJobIds(messages: OttoUiMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    const meta = m.metadata;
    if (meta?.kind === "TURN_ERROR" && meta.genJobId && cancelledTurnPayload(meta.payload)) {
      ids.add(meta.genJobId);
    }
  }
  return ids;
}

export type CardState = "idle" | "working" | "done" | "failed" | "cancelled";

/** The plan card's lifecycle derived from durable data (never optimistic-only).
 *  Order matters: a terminal result/error always wins over "working", and a cancel outranks the
 *  failure it is carried by — the same TURN_ERROR is in both sets (#602 T3). */
export function deriveCardState(args: {
  genJobId: string | null;
  submitted: boolean;
  results: Set<string>;
  errors: Set<string>;
  cancelled?: Set<string>;
}): CardState {
  const { genJobId, submitted, results, errors, cancelled } = args;
  if (genJobId && cancelled?.has(genJobId)) return "cancelled";
  if (genJobId && errors.has(genJobId)) return "failed";
  if (genJobId && results.has(genJobId)) return "done";
  if (genJobId || submitted) return "working";
  return "idle";
}

/**
 * 那扇看着生成结果的窗，开多久、多久问一次 —— **两档**（Codex E2E-CRE-PAV-003）。
 *
 * ## 病根
 *
 * 这条轮询从前只有一档：每 2.5 秒问一次，问满 48 次（两分钟）就**不再问了**。而服务端
 * 那一头，一个失败的生成走完它自己的重投序列本来就可能超过两分钟 —— `GEN_QUEUE_POLICY`
 * 允许两次重投，间隔按 pg-boss 的退避公式是 30–60 秒和 60–120 秒，最坏 180 秒纯等待，
 * 每次投递本身还要跑（`expireInSeconds` 给到 20 分钟）。于是 Codex 在真浏览器里录到那一幕：
 * 数据库 03:33:26 已经是 FAILED、1 credit 也已经退回，画布上那张 Otto 卡还写着
 * 「Generating · still working…」，刷新才变成「Failed」。屏幕不是读错了，是**先闭嘴了**。
 *
 * ## 这条规则不是这里发明的
 *
 * 同一件事在 StoryboardCard 上已经被判过一次（#782 r7，判官 r6 P1-A）：快轮打满之后
 * 服务端可能还有活作业，所以「**到顶不等于放弃**」—— 降频接着问，慢轮也到顶才真的停。
 * 判词与那条纯函数都在 `storyboard-card.ts` 的 `nextSyncPhase`，这里一个字都不重写，
 * 只把同一套齿轮交给这条一直缺第二档的观察窗：快轮 2.5s × 48（≈2 分钟，原样不动），
 * 慢轮 60s × 30（≈30 分钟）。
 *
 * 30 分钟这个数不是随手取的：它必须盖过服务端自己对「一个生成一定会有终局」的保证 ——
 * `GEN_QUEUE_POLICY.expireInSeconds`（20 分钟，一次投递最长能活多久）之外还有 worker 的
 * 收尸器兜底。屏幕停止发问的那一刻，必须晚于服务端交出终局的那一刻，否则就是同一个病。
 * 这条不变量由 `otto-inject-helpers.test.ts` 钉住，改小了会红。
 */
export const GENERATION_WATCH_GEARS = {
  /** 刚花完钱、盯着结果的那一档。原来的唯一一档，数字未动。 */
  fast: { intervalMs: 2500, maxTries: 48 },
  /** 快轮到顶、服务端还没给终局的那一档 —— 「我们不再盯着看了」不等于「我们不听了」。 */
  slow: { intervalMs: 60_000, maxTries: 30 },
} as const;

/** A job is "working" once its GEN_CARD has a genJobId (it was approved/generated)
 *  but no terminal message (GEN_RESULT or TURN_ERROR) has landed for that job yet.
 *  While any job is working the component polls the durable thread for the result. */
export function hasWorkingJob(messages: OttoUiMessage[], extraTerminalJobIds: Set<string> = new Set()): boolean {
  const terminal = new Set<string>(extraTerminalJobIds);
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
export const CARD_KINDS = new Set(["GEN_CARD", "STORYBOARD_CARD", "ACTION_CARD", "BUILD_CARD", "PERFORMANCE_CARD", "RESEARCH_CARD", "APPROVAL_CARD"]);

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

/**
 * #498 round-5 P2c: append the chained park's model NARRATION so it renders live.
 * A chained ottoApprove resume persists the model's narration as a durable TEXT
 * via a server action — nothing streams — so the "NEVER append TEXT" rule (which
 * protects against double-rendering STREAMED replies) starved exactly this
 * message until a reload. The carve-out is surgical: only the TEXT durables whose
 * ids the SERVER returned as `narrationMessageId` are appended, deduped by
 * durableId, so no streamed or already-present text can ever double-render.
 */
export function appendChainedNarrations(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
  narrationMessageIds?: readonly string[],
): OttoUiMessage[] {
  if (!narrationMessageIds || narrationMessageIds.length === 0) return messages;
  const wanted = new Set(narrationMessageIds);
  const present = new Set(
    messages.map((m) => m.metadata?.durableId).filter((id): id is string => !!id),
  );
  const additions = threadToUiMessages(fresh).filter((u) => {
    const meta = u.metadata;
    return !!meta && meta.kind === "TEXT" && wanted.has(meta.durableId) && !present.has(meta.durableId);
  });
  if (additions.length === 0) return messages;
  return [...messages, ...additions];
}

/**
 * P2-1(判官二轮复核,2026-09-04)—— 直播这一轮结束时,若 live 列表里读不出一句可读的
 * TEXT(`latestAssistantSayable` 返回 null),从 durable 补那一条,只补缺、不重复。
 *
 * 病根:走查录到首轮直播里,按下 Generate 之后画布那张始终可见的卡(`OttoTurnCard`)
 * 正文变成空态引导句「Tell Otto what you want to create or change.」,一直到刷新才回来
 * Otto 的原话。`appendMissingCards` 刻意从不补 TEXT(避免把已经流过的回复再叠一遍),但
 * 那份注释假设的前提——「流过的回复已经画出来了」——在这一轮不成立:live 列表里那条
 * assistant 消息最终没有任何 text 部件(叙述文字这次没有随流下来,只有 durable 那份
 * 存住了),`latestAssistantSayable` 于是找不到东西,画布卡只能落回空态句。
 *
 * 与 `appendChainedNarrations` 的分工:那个是服务端点名(`narrationMessageId`)的窄口子,
 * 只覆盖链式批准那一条路径;这个不看服务端点没点名,只看 live 列表此刻有没有话可说——
 * 先检查 `latestAssistantSayable(messages)` 不是 null 就原样返回,天然不会把已经画出来的
 * 那条 TEXT 再叠一遍。
 *
 * 调用点只有一处,刻意不接进 `mergeDurableIntoLive`(生成期间每 2.5 秒跑一次的那个轮询):
 * 轮询跑在这一轮**还没结束**的当中,「此刻没有可读文字」不等于「这一轮不会再有」,猜着补
 * 会有把不相关的旧 durable 行拉进来的风险(`approval-chain.test.ts` 的「un-named TEXT is
 * never re-injected」钉的正是这条界线)。只在 `OttoChatStream.tsx` 的 `useChat` 自己的
 * `onFinish` 里调用——那才是「这一轮到底有没有文字」真正见分晓的那一刻。
 */
export function backfillMissingAssistantText(
  messages: OttoUiMessage[],
  fresh: ChatThreadDTO,
): OttoUiMessage[] {
  if (latestAssistantSayable(messages) !== null) return messages;
  const present = new Set(
    messages.map((m) => m.metadata?.durableId).filter((id): id is string => !!id),
  );
  const freshMessages = threadToUiMessages(fresh);
  for (let i = freshMessages.length - 1; i >= 0; i--) {
    const u = freshMessages[i];
    if (u.role !== "assistant") continue;
    const meta = u.metadata;
    if (meta?.kind !== "TEXT") continue;
    if (present.has(meta.durableId)) continue;
    const text = u.parts
      .filter((p): p is { type: "text"; text: string } =>
        !!p && typeof p === "object" && (p as { type?: unknown }).type === "text"
        && typeof (p as { text?: unknown }).text === "string")
      .map((p) => p.text)
      .join(" ")
      .trim();
    if (!text) continue;
    return [...messages, u];
  }
  return messages;
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
