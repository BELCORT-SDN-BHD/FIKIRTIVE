"use client";
import { useCallback, useEffect, useRef } from "react";
import {
  startCanvasGen,
  getGenJob,
  getActiveGenModels,
  type ActiveGenModels,
} from "../../lib/gen-actions";
import { createCanvasNode, resolveCanvasNode } from "../../lib/canvas-actions";
import { canvasCardIsInFlightPaid, isTerminalCardStatus } from "@/lib/canvas-card-status";
import {
  CANVAS_IMAGE_DEFAULT_COUNT,
  canvasGenCostQuote,
  clampImageVariantCount,
} from "@/lib/canvas-gen-costs";
import { canvasBatchSlotOffset } from "@/lib/canvas-batch-layout";

type Pos = { x: number; y: number; w: number; h: number };
type OnNode = (node: {
  id: string;
  type: "image" | "video";
  pos: Pos;
  status: string;
  url?: string;
  prompt: string;
  generationId?: string;
  genJobId?: string;
  /**
   * WHAT THIS CALLBACK NO LONGER CARRIES (#605 r1 judge P1-1): which of the batch this card is,
   * how big the batch is, and what it was made from. It used to pass all three, taken from the
   * REQUEST — and the board wrote them onto the card, where the lineage tree, the A/B badge, the
   * same-batch frame and the compare gate read them as settled facts. They are not: the paid job
   * settles them, the row the server just wrote carries nulls, and a press can end up smaller
   * than it was asked for or with a derivation that resolves to nothing. The board read brings
   * them once they exist.
   */
}) => void;

export type CanvasImageGenOptions = {
  actionId?: string;
  sourceGenerationId?: string;
  sourceNodeId?: string;
  /**
   * #643 T2 —— 这次出图要交付的形状，就是界面上显示的那一格。
   *
   * 缺省时不发：服务端按底图快照继承 / 落默认形状。但界面上只要显示了一个形状，这里就
   * 一定带着它 —— 「显示的」与「发出去的」不许有第二个来源。
   */
  aspectRatio?: string;
  /** Exact accepted request material used only when resuming a browser receipt. */
  resumeModel?: string;
  resumeThreadId?: string | null;
  resumeApprovedCredits?: number;
};

type CanvasVideoResumeOptions = {
  model?: string;
  threadId?: string | null;
  approvedCredits?: number;
};

function isConfirmedCreditQuote(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 服务端解析的图片形状菜单 + 商家没选时会交付的那一格。 */
export type CanvasImageShapes = {
  options: string[];
  defaultAspect: string;
};

export type CanvasGenProgress = {
  nodeId: string;
  genJobId: string;
  progress: number;
  status: string;
};

export function freshCanvasActionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type AcceptedCanvasGen = { id: string; disposition: "fresh" | "reused" };
export type CanvasStartOutcome = "accepted" | "rejected" | "refunded" | "unknown";

/** Only an outcome-unknown request keeps its stable action identity for a safe replay.
 * Accepted work is already durable; deterministic rejection/refund authorizes a new action. */
export function retainCanvasActionIdentity(outcome: CanvasStartOutcome): boolean {
  return outcome === "unknown";
}

export type StoredCanvasActionReceipt = {
  version: 1;
  projectId: string;
  actionId: string;
  operation: "image" | "video" | "animate";
  prompt: string;
  pos: Pos;
  model: string;
  approvedCredits: number;
  threadId: string | null;
  count?: number;
  entityIds?: string[];
  variantSel?: Record<string, string>;
  sourceGenerationId?: string;
  sourceNodeId?: string;
  /** #643 T2：形状是商家授权内容的一部分，所以刷新后重放的必须是同一个形状。 */
  aspectRatio?: string;
};

const CANVAS_RECEIPT_PREFIX = "fikirtive:canvas-action:v1:";

function receiptStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function receiptKey(receipt: Pick<StoredCanvasActionReceipt, "projectId" | "actionId">): string {
  return `${CANVAS_RECEIPT_PREFIX}${encodeURIComponent(receipt.projectId)}:${encodeURIComponent(receipt.actionId)}`;
}

function isStoredReceipt(value: unknown): value is StoredCanvasActionReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<StoredCanvasActionReceipt>;
  const pos = item.pos as Partial<Pos> | undefined;
  return item.version === 1
    && typeof item.projectId === "string"
    && typeof item.actionId === "string"
    && (item.operation === "image" || item.operation === "video" || item.operation === "animate")
    && typeof item.prompt === "string"
    && typeof item.model === "string"
    && typeof item.approvedCredits === "number"
    && Number.isFinite(item.approvedCredits)
    && item.approvedCredits >= 0
    && (item.threadId === null || typeof item.threadId === "string")
    && !!pos
    && typeof pos.x === "number"
    && typeof pos.y === "number"
    && typeof pos.w === "number"
    && typeof pos.h === "number";
}

/** A receipt exists only between the user's confirmed submit and durable CanvasNode placement.
 * It lets a refreshed tab replay the exact same server-derived action identity, never minting a
 * fresh paid action. It is cleared before an intentional later card deletion can be resurrected. */
export function saveCanvasActionReceipt(receipt: StoredCanvasActionReceipt): boolean {
  try {
    const storage = receiptStorage();
    if (!storage) return false;
    storage.setItem(receiptKey(receipt), JSON.stringify(receipt));
    const raw = storage.getItem(receiptKey(receipt));
    if (!raw) return false;
    const saved: unknown = JSON.parse(raw);
    return isStoredReceipt(saved) && canonicalReceipt(saved) === canonicalReceipt(receipt);
  } catch {
    return false;
  }
}

export function clearCanvasActionReceipt(receipt: Pick<StoredCanvasActionReceipt, "projectId" | "actionId">): void {
  try {
    receiptStorage()?.removeItem(receiptKey(receipt));
  } catch {
    // Best effort; a stale receipt can only replay the same once-ever server action.
  }
}

export function loadCanvasActionReceipts(projectId: string): StoredCanvasActionReceipt[] {
  return scanCanvasActionReceipts(projectId).receipts;
}

type CanvasReceiptScan = {
  receipts: StoredCanvasActionReceipt[];
  recoveryAvailable: boolean;
};

function scanCanvasActionReceipts(projectId: string): CanvasReceiptScan {
  const storage = receiptStorage();
  if (!storage) return { receipts: [], recoveryAvailable: false };
  const receipts: StoredCanvasActionReceipt[] = [];
  const projectPrefix = `${CANVAS_RECEIPT_PREFIX}${encodeURIComponent(projectId)}:`;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(projectPrefix)) continue;
      const raw = storage.getItem(key);
      if (!raw) return { receipts, recoveryAvailable: false };
      const parsed: unknown = JSON.parse(raw);
      if (
        !isStoredReceipt(parsed)
        || parsed.projectId !== projectId
        || receiptKey(parsed) !== key
      ) {
        return { receipts, recoveryAvailable: false };
      }
      receipts.push(parsed);
    }
  } catch {
    return { receipts, recoveryAvailable: false };
  }
  return { receipts, recoveryAvailable: true };
}

function canonicalReceipt(receipt: StoredCanvasActionReceipt): string {
  return JSON.stringify({
    ...receipt,
    variantSel: receipt.variantSel
      ? Object.fromEntries(Object.entries(receipt.variantSel).sort(([left], [right]) => left.localeCompare(right)))
      : undefined,
  });
}

export function claimCanvasActionReceipt(
  receipt: StoredCanvasActionReceipt,
): "ok" | "another-action-pending" | "material-conflict" | "recovery-unavailable" {
  const scan = scanCanvasActionReceipts(receipt.projectId);
  if (!scan.recoveryAvailable) return "recovery-unavailable";
  const pending = scan.receipts;
  if (pending.some((item) => item.actionId !== receipt.actionId)) {
    return "another-action-pending";
  }
  const sameAction = pending.find((item) => item.actionId === receipt.actionId);
  if (sameAction && canonicalReceipt(sameAction) !== canonicalReceipt(receipt)) {
    return "material-conflict";
  }
  return saveCanvasActionReceipt(receipt) ? "ok" : "recovery-unavailable";
}

function receiptClaimError(claim: Exclude<ReturnType<typeof claimCanvasActionReceipt>, "ok">): string {
  if (claim === "another-action-pending") {
    return "We're still confirming your previous generation. Retry that same action before starting another.";
  }
  if (claim === "recovery-unavailable") {
    return "Safe retry storage is unavailable in this tab, so generation was not started. Enable browser session storage and try again.";
  }
  return "That generation action changed while it was being recovered. Retry the original action.";
}

function persistedNodePos(
  node: { x?: unknown; y?: unknown; w?: unknown; h?: unknown },
  fallback: Pos,
): Pos {
  return typeof node.x === "number" && typeof node.y === "number"
    && typeof node.w === "number" && typeof node.h === "number"
    ? { x: node.x, y: node.y, w: node.w, h: node.h }
    : fallback;
}

/** Network/server-action failures are outcome-unknown. The caller keeps its actionId and may
 * retry safely; startCanvasGen's durable server key will return the same accepted job. */
export async function startCanvasAction(
  raw: unknown,
  onError: (message: string) => void,
  onOutcome?: (outcome: CanvasStartOutcome) => void,
): Promise<AcceptedCanvasGen | null> {
  try {
    const response: unknown = await startCanvasGen(raw);
    if (response !== null && typeof response === "object") {
      const result = response as { id?: unknown; disposition?: unknown; error?: unknown; refunded?: unknown };
      if (typeof result.error === "string") {
        onOutcome?.(result.refunded === true ? "refunded" : "rejected");
        onError(result.error);
        return null;
      }
      if (
        typeof result.id === "string" && result.id.length > 0 &&
        (result.disposition === "fresh" || result.disposition === "reused")
      ) {
        onOutcome?.("accepted");
        return { id: result.id, disposition: result.disposition };
      }
    }
  } catch {
    // Outcome intentionally remains unknown; the same actionId is safe to retry.
  }
  onOutcome?.("unknown");
  onError("We couldn't confirm whether generation started — retry this same action.");
  return null;
}

/** createCanvasNode with a small retry. By the time we place a paid GenJob's card,
 *  startCanvasGen has already reserved/queued it — so a transient node-create failure must
 *  not silently drop the card, or the owner sees nothing, clicks "Make it" again, and
 *  starts a fresh action → a second paid job. Retries the owner-scoped insert;
 *  if it still fails the paid job is not lost (Canvas recovery discovers it by job) — we log. */
export async function createNodeWithRetry(
  args: Parameters<typeof createCanvasNode>[0],
  attempts = 3,
): Promise<Awaited<ReturnType<typeof createCanvasNode>>> {
  let last: Awaited<ReturnType<typeof createCanvasNode>> = { error: "not attempted" };
  for (let i = 0; i < attempts; i++) {
    // A network blip on the server action REJECTS (throws) — the real transient failure
    // class — rather than returning {error}. Catch it so the retry loop covers throws too,
    // and an exhausted throw becomes an {error} the caller can surface (never an escape).
    try {
      const response: unknown = await createCanvasNode(args);
      if (response !== null && typeof response === "object") {
        if ("id" in response && typeof (response as { id?: unknown }).id === "string") {
          return response as Awaited<ReturnType<typeof createCanvasNode>>;
        }
        if ("error" in response && typeof (response as { error?: unknown }).error === "string") {
          last = response as { error: string };
        } else {
          last = { error: "Unexpected response while placing the canvas card." };
        }
      } else {
        last = { error: "Unexpected response while placing the canvas card." };
      }
    } catch (e) {
      last = { error: e instanceof Error ? e.message : "node create threw" };
    }
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  console.warn("[canvas] createCanvasNode failed after retries — the paid job is durable and Canvas recovery will place its card:", last);
  return last;
}

/**
 * A canvas node representing a PAID generation still in flight. The delete confirm uses this to
 * warn before the owner reflexively removes a stuck-looking card and reclicks — deleting one does
 * NOT refund, and re-running mints a fresh paid action.
 *
 * The rule itself lives in `@fikirtive/core` because Otto's `remove` refusal must ask exactly the
 * same question, and its hand-kept mirror had already drifted (#602 r2, judge P1-3).
 */
export function isInFlightPaidGen(node: { type: string; status?: string; url?: string | null }): boolean {
  return canvasCardIsInFlightPaid(node);
}

/**
 * What this tab may draw on a card after telling the server what it saw (#612 r3).
 *
 * Three states, one positive licence. `accepted` is the ONLY outcome that lets this tab draw its
 * own report as truth. `refused` means the server has a settled answer and hands it over.
 * `unknown` means nobody knows: paint nothing and let the board's read bring the answer.
 */
export type CanvasResolveOutcome =
  | { kind: "accepted"; paint: string }
  | { kind: "refused"; paint: string | null }
  /** The card is gone. Taking it off the board needs no media and no further answer (#612 r4). */
  | { kind: "removed" }
  | { kind: "unknown" };

/** How many times a lost answer is asked for again before the board read takes over. */
const CANVAS_RESOLVE_ATTEMPTS = 3;
/** Grows per attempt. Short: the board's own re-read is running behind this the whole time. */
const CANVAS_RESOLVE_RETRY_MS = 400;

/**
 * Report a card's state to the server, and answer with what this tab may PAINT.
 *
 * THE RULE, and it is one rule rather than a list of cases (#612 r3, judge P1② round two): a tab
 * may draw its own report as truth only when the server SAYS it took it. Two rounds of review
 * found this one branch at a time — first a refusal being painted anyway, then an `{error}` answer
 * and a lost response being read as consent — which is what a wrong shape looks like from the
 * outside. So there is now a single positive licence and everything else is `unknown`.
 *
 * What "unknown" costs a merchant is nothing: the card keeps exactly what they are already looking
 * at, and the answer arrives from the server. The convergence has two legs and neither is this
 * tab's guess — the report is asked again a bounded number of times (a lost RESPONSE may mean the
 * write landed, or that a settlement overtook it; only the server can say which), and the board's
 * own re-read loop stays running for as long as the card is unresolved, so the settlement's answer
 * lands on the board whenever it happens. That loop is keyed on `isInFlightPaidGen`, which is why
 * an unpainted card keeps it alive.
 *
 * An `{error}` answer is NOT retried: those are deterministic refusals (the card is gone, the
 * generation is not this job's), and asking again just spends another round trip to hear it twice.
 */
export async function applyCanvasResolve(
  projectId: string,
  nodeId: string,
  input: { status: string; generationId?: string },
  options: { attempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<CanvasResolveOutcome> {
  const attempts = Math.max(1, options.attempts ?? CANVAS_RESOLVE_ATTEMPTS);
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let answer: Awaited<ReturnType<typeof resolveCanvasNode>>;
    try {
      answer = await resolveCanvasNode(projectId, nodeId, input);
    } catch (e) {
      console.warn(
        `[canvas] card resolve did not come back (attempt ${attempt}/${attempts}):`,
        e instanceof Error ? e.message : e,
      );
      if (attempt < attempts) {
        await wait(CANVAS_RESOLVE_RETRY_MS * attempt);
        continue;
      }
      return { kind: "unknown" };
    }
    if ("error" in answer) {
      console.warn(`[canvas] card resolve refused: ${answer.error}`);
      return { kind: "unknown" };
    }
    if (answer.applied) return { kind: "accepted", paint: input.status };
    // A tombstone is not a state to draw — it is a card to take away, and taking it away is the
    // one thing this tab can finish on its own (#612 r4).
    if (answer.status === "deleted") return { kind: "removed" };
    // Otherwise only an ending this tab can draw unaided. "done" needs a picture this poll does
    // not have, so the board read is what delivers it.
    return { kind: "refused", paint: isTerminalCardStatus(answer.status) ? answer.status : null };
  }
  return { kind: "unknown" };
}

export async function poll(
  jobId: string,
  onDone: (urls: string[], status: string, generationIds: string[]) => void,
  cancelledRef: React.MutableRefObject<boolean>,
  opts: {
    projectId?: string;
    intervalMs?: number;
    maxPolls?: number;
    onProgress?: (progress: number, status: string) => void;
  } = {},
) {
  const intervalMs = opts.intervalMs ?? 2500;
  // ~8 min at 2.5s. Video gens can legitimately exceed 2 min (the old 48-iteration/~2-min cap
  // spuriously reported "failed"); the worker settles late ones regardless of the client poll.
  const maxPolls = opts.maxPolls ?? 192;
  for (let i = 0; i < maxPolls; i++) {
    if (cancelledRef.current) return;
    let job: Awaited<ReturnType<typeof getGenJob>> | null = null;
    try {
      job = await getGenJob(jobId, opts.projectId);
    } catch (e) {
      console.warn("[canvas] generation status lookup failed:", e instanceof Error ? e.message : e);
      return onDone([], "timeout", []);
    }
    if (!job) return onDone([], "timeout", []);
    const progress = typeof job.progress === "number" && Number.isFinite(job.progress)
      ? Math.max(0, Math.min(100, job.progress))
      : 0;
    opts.onProgress?.(progress, job.status);
    if (job.status === "DONE") return onDone(job.urls, job.urls.length ? "done" : "missing", job.generationIds ?? []);
    if (job.status === "FAILED") return onDone([], "failed", []);
    // A cancelled job has its own ending (#612 · #599 D4). Without this the open tab keeps
    // polling a job that stopped, and eventually shows the soft "still working" copy for it.
    if (job.status === "CANCELLED") return onDone([], "cancelled", []);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Client-side give-up ≠ failure: the worker may still finish and settle. Report a distinct
  // "timeout" so the card shows "still working — check back" instead of a hard "failed".
  onDone([], "timeout", []);
}

export function useCanvasGen(
  projectId: string,
  onNode: OnNode,
  onResolve: (nodeId: string, url: string | null, status: string, generationId?: string) => void,
  activeThreadId?: string | null,
  onError?: (msg: string) => void,
  onBalanceRefresh?: () => void | Promise<void>,
  onProgress?: (progress: CanvasGenProgress) => void,
  /**
   * One paid job is FINISHED and every card it produced is on the board — fired once per job,
   * after the last sibling is placed, and never for a job that produced no media.
   *
   * `onResolve` fires per CARD, which is the wrong unit for anything that reads the whole board:
   * a batch places its siblings one server round trip apart, so a per-card trigger read the
   * board once per card (r3 review P2-1). Nothing here spends: it reports that a job settled.
   */
  onBatchSettled?: () => void,
  /**
   * This card is GONE — the server says it was deleted (in another tab, or by Otto). Take it off
   * the board; nothing else can. Board reads omit tombstones, so a card kept here after its row
   * became a tombstone is a card that can never be corrected by a later read (#612 r4).
   */
  onRemoved?: (nodeId: string) => void,
) {
  const cancelledRef = useRef(false);
  const resumedReceiptIdsRef = useRef(new Set<string>());
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);
  // Resolve active capability ids + exact quotes server-side. Cache after first fetch and await
  // before every spend; provider-backed model ids never enter the browser.
  const modelsRef = useRef<ActiveGenModels | null>(null);
  const ensureModels = useCallback(async () => {
    if (!modelsRef.current) {
      const response: unknown = await getActiveGenModels();
      if (
        response === null || typeof response !== "object" ||
        typeof (response as { image?: unknown }).image !== "string" ||
        !(response as { image: string }).image ||
        typeof (response as { video?: unknown }).video !== "string" ||
        !(response as { video: string }).video ||
        !isConfirmedCreditQuote((response as { imageCredits?: unknown }).imageCredits) ||
        !isConfirmedCreditQuote((response as { videoCredits?: unknown }).videoCredits) ||
        // #643 T2：形状菜单和默认形状必须真的到齐，否则选择器会拿一个空菜单或一个
        // 界面自己编的默认值去渲染 —— 那就是「显示的」与「会交付的」第二次分家。
        !Array.isArray((response as { imageAspectRatios?: unknown }).imageAspectRatios) ||
        (response as { imageAspectRatios: unknown[] }).imageAspectRatios.length === 0 ||
        typeof (response as { imageDefaultAspect?: unknown }).imageDefaultAspect !== "string" ||
        !(response as { imageDefaultAspect: string }).imageDefaultAspect
      ) {
        throw new Error("Unexpected generation model response");
      }
      modelsRef.current = response as ActiveGenModels;
    }
    return modelsRef.current;
  }, []);
  const quoteCosts = useCallback(async (imageCount = CANVAS_IMAGE_DEFAULT_COUNT) => (
    canvasGenCostQuote(await ensureModels(), imageCount)
  ), [ensureModels]);
  /** #643 T2：形状菜单只有一个来源 —— 服务端解析的那份。界面一格都不写死。 */
  const imageShapes = useCallback(async (): Promise<CanvasImageShapes> => {
    const models = await ensureModels();
    return { options: models.imageAspectRatios, defaultAspect: models.imageDefaultAspect };
  }, [ensureModels]);
  // A paid-gen kickoff that fails before any card is placed (out of credits, model disabled,
  // guardian block, or a node-create that never recovered) must tell the user — otherwise they
  // see nothing, assume the app broke, and re-click as a fresh action → a real
  // second charge attempt (F19/F20).
  const fail = useCallback(
    (msg: string) => onError?.(msg || "That didn't go through — please try again."),
    [onError],
  );
  const loadModelsForAction = useCallback(async () => {
    try {
      return await ensureModels();
    } catch {
      fail("Generation settings couldn't be confirmed — please try again.");
      return null;
    }
  }, [ensureModels, fail]);

  const generateImage = useCallback(async (
    prompt: string,
    pos: Pos,
    entityIds: string[] = [],
    variantSel: Record<string, string> = {},
    count: number = CANVAS_IMAGE_DEFAULT_COUNT,
    options: CanvasImageGenOptions = {},
  ): Promise<boolean> => {
    if (!!options.sourceGenerationId !== !!options.sourceNodeId) {
      fail("An image edit needs both its source image and source canvas card.");
      return false;
    }
    const vsel = Object.keys(variantSel).length ? variantSel : undefined;
    // Default one image; the owner can request more variants (up to MAX_GEN_COUNT=4).
    // count is a priced/gated/capped spend parameter and the charge scales by it, so it's
    // clamped to [1, MAX] here and re-validated by the server genRequest gate. Any sibling
    // cards below are pure placement of already-charged variants (no extra spend).
    const safeCount = clampImageVariantCount(count);
    let image: string;
    let approvedCredits: number;
    if (typeof options.resumeModel === "string") {
      if (!options.resumeModel || !isConfirmedCreditQuote(options.resumeApprovedCredits)) {
        fail("Generation settings couldn't be confirmed — please try again.");
        return false;
      }
      image = options.resumeModel;
      approvedCredits = options.resumeApprovedCredits;
    } else {
      const models = await loadModelsForAction();
      if (!models) return false;
      image = models.image;
      approvedCredits = models.imageCredits * safeCount;
    }
    const actionId = options.actionId ?? freshCanvasActionId();
    const requestThreadId = options.resumeThreadId !== undefined
      ? options.resumeThreadId
      : activeThreadId ?? null;
    const req = {
      actionId,
      expectedCredits: approvedCredits,
      projectId,
      prompt,
      count: safeCount,
      kind: "image" as const,
      model: image,
      entityIds,
      ...(vsel && { variantSel: vsel }),
      ...(options.sourceGenerationId && { sourceGenerationId: options.sourceGenerationId }),
      ...(options.aspectRatio && { aspectRatio: options.aspectRatio }),
      ...(requestThreadId && { threadId: requestThreadId }),
    };
    const receipt: StoredCanvasActionReceipt = {
      version: 1,
      projectId,
      actionId,
      operation: "image",
      prompt,
      pos,
      model: image,
      approvedCredits,
      threadId: requestThreadId,
      count: safeCount,
      entityIds,
      ...(vsel ? { variantSel: vsel } : {}),
      ...(options.sourceGenerationId ? { sourceGenerationId: options.sourceGenerationId } : {}),
      ...(options.sourceNodeId ? { sourceNodeId: options.sourceNodeId } : {}),
      ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    };
    const receiptClaim = claimCanvasActionReceipt(receipt);
    if (receiptClaim !== "ok") {
      fail(receiptClaimError(receiptClaim));
      return false;
    }
    const startOutcome = { current: "unknown" as CanvasStartOutcome };
    const started = await startCanvasAction(req, fail, (outcome) => { startOutcome.current = outcome; });
    if (!started) {
      if (!retainCanvasActionIdentity(startOutcome.current)) clearCanvasActionReceipt(receipt);
      return false;
    }
    void onBalanceRefresh?.();
    const created = await createNodeWithRetry({
      projectId,
      type: "image",
      ...pos,
      prompt,
      genJobId: started.id,
      status: "pending",
      ...(requestThreadId ? { threadId: requestThreadId } : {}),
    });
    if ("error" in created) {
      fail("Your image is generating — the card didn't appear yet. Refresh Canvas to recover it without paying again.");
      return false;
    }
    clearCanvasActionReceipt(receipt);
    const createdPos = persistedNodePos(created, pos);
    onNode({
      id: created.id,
      // The card the browser puts down knows ONE thing: a job was accepted. Whether it has
      // started is the job row's to say, and the board read brings that word seconds later — so
      // this says queued, which is true either way, and never "making this now" (#602 T3).
      // The stored row stays `pending`; queued/generating are faces, not row words.
      status: "queued",
      type: "image",
      pos: createdPos,
      prompt,
      genJobId: started.id,
    });
    poll(started.id, async (urls, status, generationIds) => {
      void onBalanceRefresh?.();
      if (status !== "done" || urls.length === 0) {
        const outcome = await applyCanvasResolve(projectId, created.id, { status });
        if (outcome.kind === "accepted") onResolve(created.id, null, outcome.paint);
        else if (outcome.kind === "removed") onRemoved?.(created.id);
        else {
          if (outcome.kind === "refused" && outcome.paint) onResolve(created.id, null, outcome.paint);
          onBatchSettled?.(); // convergence: the board read brings whatever the server settles on
        }
        return;
      }
      // primary card → first variant
      const primaryGenerationId = generationIds[0];
      if (!primaryGenerationId) {
        const outcome = await applyCanvasResolve(projectId, created.id, { status: "missing" });
        if (outcome.kind === "accepted") onResolve(created.id, null, outcome.paint);
        else if (outcome.kind === "removed") onRemoved?.(created.id);
        else {
          if (outcome.kind === "refused" && outcome.paint) onResolve(created.id, null, outcome.paint);
          onBatchSettled?.();
        }
        return;
      }
      const anchor = await applyCanvasResolve(projectId, created.id, { status: "done", generationId: primaryGenerationId });
      // Only an accepted report may put this tab's picture on the card. Anything else keeps what
      // the merchant is looking at; the siblings below still belong on the board, and the batch's
      // own board read at the end of this loop is what brings the server's answer.
      if (anchor.kind === "accepted") onResolve(created.id, urls[0], "done", primaryGenerationId);
      else if (anchor.kind === "removed") onRemoved?.(created.id);
      else if (anchor.kind === "refused" && anchor.paint) onResolve(created.id, null, anchor.paint);
      // one sibling card per remaining variant, laid out in a 2×2 cluster. Each
      // is a plain canvas-node placement of an already-generated (already-charged)
      // Generation — createCanvasNode is not a spend path.
      for (let i = 1; i < urls.length; i++) {
        // Shared grid (canvas-batch-layout) so every card of one batch is separately visible,
        // and so server-side recovery re-places a lost sibling in the same slot.
        const slot = canvasBatchSlotOffset(i, { w: createdPos.w, h: createdPos.h });
        const sx = createdPos.x + slot.dx;
        const sy = createdPos.y + slot.dy;
        const generationId = generationIds[i];
        if (!generationId) continue;
        // The browser says WHERE, never WHO (#603 T4). It used to send a "source node" along with
        // each sibling — the batch's own anchor — into the one column that also meant "made
        // from", and the server enforced it. Both facts are the paid job's to state now: the
        // server reads this card's position and its batch's anchor off the job itself.
        const sib = await createCanvasNode({
          projectId,
          type: "image",
          x: sx,
          y: sy,
          w: createdPos.w,
          h: createdPos.h,
          prompt,
          generationId,
          genJobId: started.id,
          status: "done",
          ...(requestThreadId ? { threadId: requestThreadId } : {}),
        });
        if ("error" in sib) continue;
        const siblingPos = persistedNodePos(sib, {
          x: sx,
          y: sy,
          w: createdPos.w,
          h: createdPos.h,
        });
        onNode({
          id: sib.id,
          type: "image",
          pos: siblingPos,
          status: "done",
          prompt,
          generationId,
          genJobId: started.id,
        });
        onResolve(sib.id, urls[i], "done", generationId);
      }
      // Every card of this job is placed. Only now is there a whole batch to read.
      onBatchSettled?.();
    }, cancelledRef, {
      projectId,
      onProgress: (progress, status) => onProgress?.({
        nodeId: created.id,
        genJobId: started.id,
        progress,
        status,
      }),
    });
    return true;
  }, [projectId, onNode, onResolve, activeThreadId, fail, onBalanceRefresh, onProgress, onBatchSettled, onRemoved, loadModelsForAction]);

  const animate = useCallback(async (
    sourceGenerationId: string,
    sourceNodeId: string,
    prompt: string,
    pos: Pos,
    actionId?: string,
    resume: CanvasVideoResumeOptions = {},
  ): Promise<boolean> => {
    let video: string;
    let approvedCredits: number;
    if (typeof resume.model === "string") {
      if (!resume.model || !isConfirmedCreditQuote(resume.approvedCredits)) {
        fail("Generation settings couldn't be confirmed — please try again.");
        return false;
      }
      video = resume.model;
      approvedCredits = resume.approvedCredits;
    } else {
      const models = await loadModelsForAction();
      if (!models) return false;
      video = models.video;
      approvedCredits = models.videoCredits;
    }
    const stableActionId = actionId ?? freshCanvasActionId();
    const requestThreadId = resume.threadId !== undefined
      ? resume.threadId
      : activeThreadId ?? null;
    const req = {
      actionId: stableActionId,
      expectedCredits: approvedCredits,
      projectId,
      prompt,
      count: 1,
      kind: "video" as const,
      model: video,
      sourceGenerationId,
      ...(requestThreadId && { threadId: requestThreadId }),
    };
    const receipt: StoredCanvasActionReceipt = {
      version: 1,
      projectId,
      actionId: stableActionId,
      operation: "animate",
      prompt,
      pos,
      model: video,
      approvedCredits,
      threadId: requestThreadId,
      sourceGenerationId,
      sourceNodeId,
    };
    const receiptClaim = claimCanvasActionReceipt(receipt);
    if (receiptClaim !== "ok") {
      fail(receiptClaimError(receiptClaim));
      return false;
    }
    const startOutcome = { current: "unknown" as CanvasStartOutcome };
    const started = await startCanvasAction(req, fail, (outcome) => { startOutcome.current = outcome; });
    if (!started) {
      if (!retainCanvasActionIdentity(startOutcome.current)) clearCanvasActionReceipt(receipt);
      return false;
    }
    void onBalanceRefresh?.();
    const created = await createNodeWithRetry({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", ...(requestThreadId ? { threadId: requestThreadId } : {}) });
    if ("error" in created) { fail("Your video is generating — the card didn't appear yet. Refresh Canvas to recover it without paying again."); return false; }
    clearCanvasActionReceipt(receipt);
    const createdPos = persistedNodePos(created, pos);
    onNode({
      id: created.id,
      type: "video",
      pos: createdPos,
      // Queued, not "making this now" — see the image path above (#602 T3).
      status: "queued",
      prompt,
      genJobId: started.id,
    });
    poll(started.id, async (urls, status, generationIds) => {
      void onBalanceRefresh?.();
      const generationId = generationIds[0];
      const resolvedStatus = status === "done" && !generationId ? "missing" : status;
      const outcome = await applyCanvasResolve(projectId, created.id, { status: resolvedStatus, ...(generationId ? { generationId } : {}) });
      if (outcome.kind === "removed") { onRemoved?.(created.id); return; }
      if (outcome.kind !== "accepted") {
        if (outcome.kind === "refused" && outcome.paint) onResolve(created.id, null, outcome.paint);
        onBatchSettled?.(); // convergence: the board read brings whatever the server settles on
        return;
      }
      onResolve(created.id, urls[0] ?? null, resolvedStatus, generationId);
      // A video job is a batch of one: it has settled the moment its card carries media.
      if (resolvedStatus === "done" && urls[0]) onBatchSettled?.();
    }, cancelledRef, {
      projectId,
      onProgress: (progress, status) => onProgress?.({
        nodeId: created.id,
        genJobId: started.id,
        progress,
        status,
      }),
    });
    return true;
  }, [projectId, onNode, onResolve, activeThreadId, fail, onBalanceRefresh, onProgress, onBatchSettled, onRemoved, loadModelsForAction]);

  // Phase 3: text-to-video. The same paid video path as animate(), minus the
  // source frame — the gate allows video without sourceGenerationId (it's the
  // Gen-space path) and the provider uses the model's t2v endpoint. Video is
  // always count=1 (the shared startGen authority forces it). New spend entry, existing spend logic.
  const generateVideoFromText = useCallback(async (
    prompt: string,
    pos: Pos,
    actionId?: string,
    resume: CanvasVideoResumeOptions = {},
  ): Promise<boolean> => {
    let video: string;
    let approvedCredits: number;
    if (typeof resume.model === "string") {
      if (!resume.model || !isConfirmedCreditQuote(resume.approvedCredits)) {
        fail("Generation settings couldn't be confirmed — please try again.");
        return false;
      }
      video = resume.model;
      approvedCredits = resume.approvedCredits;
    } else {
      const models = await loadModelsForAction();
      if (!models) return false;
      video = models.video;
      approvedCredits = models.videoCredits;
    }
    const stableActionId = actionId ?? freshCanvasActionId();
    const requestThreadId = resume.threadId !== undefined
      ? resume.threadId
      : activeThreadId ?? null;
    const req = {
      actionId: stableActionId,
      expectedCredits: approvedCredits,
      projectId,
      prompt,
      count: 1,
      kind: "video" as const,
      model: video,
      ...(requestThreadId && { threadId: requestThreadId }),
    };
    const receipt: StoredCanvasActionReceipt = {
      version: 1,
      projectId,
      actionId: stableActionId,
      operation: "video",
      prompt,
      pos,
      model: video,
      approvedCredits,
      threadId: requestThreadId,
    };
    const receiptClaim = claimCanvasActionReceipt(receipt);
    if (receiptClaim !== "ok") {
      fail(receiptClaimError(receiptClaim));
      return false;
    }
    const startOutcome = { current: "unknown" as CanvasStartOutcome };
    const started = await startCanvasAction(req, fail, (outcome) => { startOutcome.current = outcome; });
    if (!started) {
      if (!retainCanvasActionIdentity(startOutcome.current)) clearCanvasActionReceipt(receipt);
      return false;
    }
    void onBalanceRefresh?.();
    const created = await createNodeWithRetry({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", ...(requestThreadId ? { threadId: requestThreadId } : {}) });
    if ("error" in created) { fail("Your video is generating — the card didn't appear yet. Refresh Canvas to recover it without paying again."); return false; }
    clearCanvasActionReceipt(receipt);
    const createdPos = persistedNodePos(created, pos);
    onNode({
      id: created.id,
      type: "video",
      pos: createdPos,
      // Queued, not "making this now" — see the image path above (#602 T3).
      status: "queued",
      prompt,
      genJobId: started.id,
    });
    poll(started.id, async (urls, status, generationIds) => {
      void onBalanceRefresh?.();
      const generationId = generationIds[0];
      const resolvedStatus = status === "done" && !generationId ? "missing" : status;
      const outcome = await applyCanvasResolve(projectId, created.id, { status: resolvedStatus, ...(generationId ? { generationId } : {}) });
      if (outcome.kind === "removed") { onRemoved?.(created.id); return; }
      if (outcome.kind !== "accepted") {
        if (outcome.kind === "refused" && outcome.paint) onResolve(created.id, null, outcome.paint);
        onBatchSettled?.(); // convergence: the board read brings whatever the server settles on
        return;
      }
      onResolve(created.id, urls[0] ?? null, resolvedStatus, generationId);
      // A video job is a batch of one: it has settled the moment its card carries media.
      if (resolvedStatus === "done" && urls[0]) onBatchSettled?.();
    }, cancelledRef, {
      projectId,
      onProgress: (progress, status) => onProgress?.({
        nodeId: created.id,
        genJobId: started.id,
        progress,
        status,
      }),
    });
    return true;
  }, [projectId, onNode, onResolve, activeThreadId, fail, onBalanceRefresh, onProgress, onBatchSettled, onRemoved, loadModelsForAction]);

  useEffect(() => {
    let stopped = false;
    const pending = loadCanvasActionReceipts(projectId).filter((receipt) => {
      if (resumedReceiptIdsRef.current.has(receipt.actionId)) return false;
      resumedReceiptIdsRef.current.add(receipt.actionId);
      return true;
    });
    if (!pending.length) return;

    void (async () => {
      for (const receipt of pending) {
        if (stopped) return;
        if (receipt.operation === "image") {
          const hasSourceGeneration = typeof receipt.sourceGenerationId === "string";
          const hasSourceNode = typeof receipt.sourceNodeId === "string";
          if (hasSourceGeneration !== hasSourceNode) {
            clearCanvasActionReceipt(receipt);
            continue;
          }
          await generateImage(
            receipt.prompt,
            receipt.pos,
            receipt.entityIds ?? [],
            receipt.variantSel ?? {},
            receipt.count ?? CANVAS_IMAGE_DEFAULT_COUNT,
            {
              actionId: receipt.actionId,
              resumeModel: receipt.model,
              resumeThreadId: receipt.threadId,
              resumeApprovedCredits: receipt.approvedCredits,
              ...(receipt.sourceGenerationId
                ? { sourceGenerationId: receipt.sourceGenerationId }
                : {}),
              ...(receipt.sourceNodeId ? { sourceNodeId: receipt.sourceNodeId } : {}),
              // #643 T2：重放的必须是商家当时看着按下去的那个形状，不是刷新后的默认值。
              ...(receipt.aspectRatio ? { aspectRatio: receipt.aspectRatio } : {}),
            },
          );
          continue;
        }
        if (receipt.operation === "animate") {
          if (!receipt.sourceGenerationId || !receipt.sourceNodeId) {
            clearCanvasActionReceipt(receipt);
            continue;
          }
          await animate(
            receipt.sourceGenerationId,
            receipt.sourceNodeId,
            receipt.prompt,
            receipt.pos,
            receipt.actionId,
            { model: receipt.model, threadId: receipt.threadId, approvedCredits: receipt.approvedCredits },
          );
          continue;
        }
        await generateVideoFromText(
          receipt.prompt,
          receipt.pos,
          receipt.actionId,
          { model: receipt.model, threadId: receipt.threadId, approvedCredits: receipt.approvedCredits },
        );
      }
    })();

    return () => { stopped = true; };
  }, [animate, generateImage, generateVideoFromText, projectId]);

  return { generateImage, animate, generateVideoFromText, quoteCosts, imageShapes, cancelledRef };
}
