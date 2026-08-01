"use client";
import { useCallback, useEffect, useRef } from "react";
import {
  startCanvasGen,
  getGenJob,
  getActiveGenModels,
  type ActiveGenModels,
} from "../../lib/gen-actions";
import { createCanvasNode, resolveCanvasNode } from "../../lib/canvas-actions";
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
  sourceNodeId?: string;
  generationId?: string;
  genJobId?: string;
  variantIndex?: number;
  variantCount?: number;
}) => void;

export type CanvasImageGenOptions = {
  actionId?: string;
  sourceGenerationId?: string;
  sourceNodeId?: string;
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
 * A canvas node representing a PAID generation still in flight — an image/video gen
 * node that hasn't resolved to media yet (status "pending"/"timeout", no url).
 * Deleting one does NOT refund (its GenJob already reserved and will settle) and
 * re-running starts a fresh paid action → a SECOND charge. The delete
 * confirm uses this to warn before the owner reflexively removes a stuck-looking
 * card and reclicks. "failed" is terminal (already refunded) and "done"/url-present
 * is finished — both safe to delete.
 */
export function isInFlightPaidGen(node: { type: string; status?: string; url?: string | null }): boolean {
  if (node.type !== "image" && node.type !== "video") return false;
  if (node.url) return false;
  return node.status === "pending" || node.status === "timeout";
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
        !isConfirmedCreditQuote((response as { videoCredits?: unknown }).videoCredits)
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
      ...(options.sourceNodeId && { sourceNodeId: options.sourceNodeId }),
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
      type: "image",
      pos: createdPos,
      status: "pending",
      prompt,
      genJobId: started.id,
      variantIndex: 0,
      variantCount: safeCount,
      ...(options.sourceNodeId && { sourceNodeId: options.sourceNodeId }),
    });
    poll(started.id, async (urls, status, generationIds) => {
      void onBalanceRefresh?.();
      if (status !== "done" || urls.length === 0) {
        void resolveCanvasNode(projectId, created.id, { status });
        onResolve(created.id, null, status);
        return;
      }
      // primary card → first variant
      const primaryGenerationId = generationIds[0];
      if (!primaryGenerationId) {
        void resolveCanvasNode(projectId, created.id, { status: "missing" });
        onResolve(created.id, null, "missing");
        return;
      }
      void resolveCanvasNode(projectId, created.id, { status: "done", generationId: primaryGenerationId });
      onResolve(created.id, urls[0], "done", primaryGenerationId);
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
        // TWO different facts used to share one name. The BATCH ANCHOR is the card this sibling
        // is laid out around; the placement path stores it in CanvasNode.sourceNodeId and
        // derives it itself, so it is passed here only to match what the server would compute.
        // The SOURCE is what this card was made FROM — a plain batch has none, its cards came
        // out of one press together. Sending the anchor on as a source drew every batch as a
        // family tree and told the merchant "Made from" about a card that made nothing.
        const batchAnchorNodeId = options.sourceNodeId ?? created.id;
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
          sourceNodeId: batchAnchorNodeId,
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
          variantIndex: i,
          variantCount: generationIds.length,
          ...(options.sourceNodeId ? { sourceNodeId: options.sourceNodeId } : {}),
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
  }, [projectId, onNode, onResolve, activeThreadId, fail, onBalanceRefresh, onProgress, onBatchSettled, loadModelsForAction]);

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
    const created = await createNodeWithRetry({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", sourceNodeId, ...(requestThreadId ? { threadId: requestThreadId } : {}) });
    if ("error" in created) { fail("Your video is generating — the card didn't appear yet. Refresh Canvas to recover it without paying again."); return false; }
    clearCanvasActionReceipt(receipt);
    const createdPos = persistedNodePos(created, pos);
    onNode({
      id: created.id,
      type: "video",
      pos: createdPos,
      status: "pending",
      prompt,
      sourceNodeId,
      genJobId: started.id,
      variantIndex: 0,
      variantCount: 1,
    });
    poll(started.id, (urls, status, generationIds) => {
      void onBalanceRefresh?.();
      const generationId = generationIds[0];
      const resolvedStatus = status === "done" && !generationId ? "missing" : status;
      void resolveCanvasNode(projectId, created.id, { status: resolvedStatus, ...(generationId ? { generationId } : {}) });
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
  }, [projectId, onNode, onResolve, activeThreadId, fail, onBalanceRefresh, onProgress, onBatchSettled, loadModelsForAction]);

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
      status: "pending",
      prompt,
      genJobId: started.id,
      variantIndex: 0,
      variantCount: 1,
    });
    poll(started.id, (urls, status, generationIds) => {
      void onBalanceRefresh?.();
      const generationId = generationIds[0];
      const resolvedStatus = status === "done" && !generationId ? "missing" : status;
      void resolveCanvasNode(projectId, created.id, { status: resolvedStatus, ...(generationId ? { generationId } : {}) });
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
  }, [projectId, onNode, onResolve, activeThreadId, fail, onBalanceRefresh, onProgress, onBatchSettled, loadModelsForAction]);

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

  return { generateImage, animate, generateVideoFromText, quoteCosts, cancelledRef };
}
