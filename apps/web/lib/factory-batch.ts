/**
 * factory-batch — the B3 factory batch ORCHESTRATION core (W-B3-F-P, spec §5.2).
 *
 * Headless batch orchestration over the ONE existing spend authority, `startGen`.
 * This file is deliberately a plain module (no server-action directive). Only the two
 * thin wrappers in factory-actions.ts are the owner-scoped action surface. Keeping the loop here lets tests drive it
 * with an injected `startGen` (a stub for behaviour, the real one for the ledger).
 *
 * MONEY SAFETY (零新钱路复用现有管线):
 *   - This layer NEVER touches credits. It does not import or call
 *     reserveCredits / settleCredits / refundReservation, never creates a GenJob,
 *     never calls a provider. Each cell's reserve (same-tx with the GenJob insert)
 *     and each cell's failure-refund happen INSIDE startGen / the worker — per cell.
 *   - Generic factory cells retain their positional logical identity. Callers whose cells
 *     have durable domain ids may set `idempotencyId`; then the logical identity is a
 *     length-delimited hash of batchId + that stable id, independent of array order. The
 *     resulting factory key remains 79 characters and is still parsed/decided by startGen.
 *   - Migration compatibility is read-only routing, never a reuse verdict. Stable-id batches
 *     scan owner+project-scoped any-status positional history before dispatch and one-to-one
 *     match full persisted material. A matched legacy cell is handed back to startGen under
 *     its old logical prefix; startGen repeats the verdict under the project lock. Ambiguous
 *     old/new material fails closed before any dispatch because old rows do not store entry ids.
 *   - Quote = sum of per-cell `pricedGenCredits(...)` computed from the SAME inputs
 *     the cell hands startGen, so quote == reserve == settle per cell (no batch-level
 *     price constant; §6.5 credits-only via pricedGenCredits).
 *   - text cells are $0: they never enter startGen and never reserve.
 *   - Partial failure refunds ONLY the failed cells — that refund is startGen's /
 *     the worker's own per-cell refund. There is deliberately NO batch-level
 *     rollback / all-refund here (it would double-refund).
 *   - GenerationBatch grouping is a pure metadata write (GenJob.batchId soft-ref,
 *     schema.prisma:465) done AFTER startGen returns — it moves no money.
 */
import {
  imageDefaults,
  pricedGenCredits,
  GEN_MODELS,
  GEN_VIDEO_MODELS,
  type GenModel,
  type GenSpendInput,
} from "@fikirtive/core";
import type { PrismaClient } from "@fikirtive/db";
import {
  factoryAttemptKey,
  factoryHistoryDisposition,
  factoryLogicalPrefix,
  factoryMaterialMatches,
  factoryReusedPrior,
  normalizeFactoryMaterial,
  FACTORY_HISTORY_SELECT,
  type FactoryAttemptKey,
  type FactoryHistoryRow,
  type FactoryMaterial,
} from "./batch-idempotency";

/** Batch size ceiling. A money-safety guard: an unbounded batch would let one
 *  approved call fan out into unbounded per-cell reserves. 24 covers the widest
 *  realistic grid (platforms × sizes × hooks) and the F1 20-cell threshold. This
 *  is a COUNT limit, never a price. */
export const MAX_BATCH_CELLS = 24;

/** Bounds mirror genRequest's field bounds — but genRequest (inside startGen) stays
 *  the SOLE spend authority; these only shape the batch input. */
const MAX_PROMPT = 2000;
const MAX_ID = 64;

/** A cell that produces a generation → goes through startGen (paid, per-cell reserve). */
export interface GenCell {
  type: "gen";
  prompt: string;
  /** image | video. Defaults to image when omitted. */
  kind?: "image" | "video";
  /** model id; startGen/genRequest defaults + validates it. */
  model?: string;
  /** 1..MAX_GEN_COUNT (image batch sampling). startGen/genRequest validates. */
  count?: number;
  entityIds?: string[];
  /** i2v source keyframe (owned Generation id). */
  sourceGenerationId?: string | null;
  tailGenerationId?: string | null;
  referenceVideoGenerationId?: string | null;
  variantSel?: Record<string, string>;
  shotId?: string | null;
  /** video controls (validated against the model in genRequest). */
  durationSeconds?: number | null;
  resolution?: string | null;
  aspectRatio?: string | null;
  fps?: number | null;
  audio?: boolean | null;
  /** Server-derived durable domain id for order-independent logical-cell identity. */
  idempotencyId?: string;
}

/** A text-only cell (e.g. an ad hook/headline variant). ALWAYS $0 — never spends. */
export interface TextCell {
  type: "text";
  text: string;
}

export type BatchCell = GenCell | TextCell;

/** The startGen port — injected so the loop is testable and so this core never
 *  imports the server-action module directly (keeps the spend authority single). */
export type StartGenPort = (
  req: Record<string, unknown>,
  /** 这一格在 `args.cells` 里的下标(#749)。真 `startGen` 不看第二个参数;需要「商家为
   *  **这一格**签的是什么」的调用方(战役确认的锁内对签)靠它钉到正确的那一行,而不是靠
   *  数调用次数 —— text 与 precheck 失败的格根本不进这里,数次数一定会数错行。 */
  cellIndex?: number,
) => Promise<
  | { id: string; disposition: "fresh" | "reused" }
  // `retryable` = 结果不明、花钱之前就停住了(#656 P1)。这一层照旧只把错误原样呈上去。
  | { error: string; disposition?: "conflict" | "retryable" }
>;

export interface OrchestrateDeps {
  startGen: StartGenPort;
  prisma: Pick<PrismaClient, "generationBatch" | "genJob">;
}

export interface OrchestrateArgs {
  ownerId: string;
  projectId: string;
  /** Caller-stable logical batch id = GenerationBatch.id and an input to the per-cell hash. */
  batchId: string;
  /** Caller-stable for one confirmation/network replay; a later explicit Retry uses a new id. */
  attemptId: string;
  name?: string;
  threadId?: string | null;
  cells: BatchCell[];
}

/** Per-cell dispatch outcome. `credits` = this cell's quote (== its reserve == its
 *  eventual settle). text cells report 0. */
export interface CellResult {
  index: number;
  type: "gen" | "text";
  /** queued = a fresh GenJob this run (charged); reused = an existing job selected atomically by
   *  startGen (zero new charge); text = $0 no-op; error = precheck/startGen refused
   *  this cell (zero charge). */
  status: "queued" | "reused" | "text" | "error";
  jobId?: string;
  /** This cell's NEW charge this run: the quote for a freshly dispatched (queued) cell; 0 for a
   *  reused / text / error cell (transparency — totalCredits must equal this run's reservation). */
  credits: number;
  error?: string;
}

export interface BatchResult {
  batchId: string;
  cells: CellResult[];
  /** sum of ONLY this run's newly-dispatched (queued) cells' quotes — reused / text / error cells
   *  contribute 0, so this equals the credits actually reserved this run (宪法 3 transparency). */
  totalCredits: number;
  /** dispatched = cells that enqueued a NEW job this run; reused = cells that hit an existing
   *  attempt/logical job (no new charge); failed = cells precheck/startGen refused. */
  dispatched: number;
  reused: number;
  failed: number;
}

/** A thrown infrastructure failure stops sequential dispatch. `partial` contains only outcomes
 *  the server confirmed before the interruption. The current cell is explicitly distinguished:
 *  a history-read failure is known not started, while a thrown startGen has an unknown outcome. */
export interface BatchInterruption {
  partial: BatchResult;
  atIndex: number;
  current: "not_started" | "unknown";
  /** Later cells definitely not started; includes current only when current=not_started. */
  notStarted: number;
}

export type BatchFailure = { error: string; partial?: BatchInterruption };

/** Exact persisted request shape, shared with startGen's lock-time binding. Callers pass
 *  genCellError first so a video model is valid before video defaults are resolved. */
function cellMaterial(cell: GenCell, threadId?: string | null): FactoryMaterial {
  return normalizeFactoryMaterial({
    prompt: cell.prompt,
    model: cell.model ?? "seedream",
    kind: cell.kind ?? "image",
    count: cell.count ?? 1,
    entityIds: cell.entityIds,
    variantSel: cell.variantSel,
    sourceGenerationId: cell.sourceGenerationId,
    tailGenerationId: cell.tailGenerationId,
    referenceVideoGenerationId: cell.referenceVideoGenerationId,
    shotId: cell.shotId,
    threadId,
    durationSeconds: cell.durationSeconds,
    resolution: cell.resolution,
    aspectRatio: cell.aspectRatio,
    fps: cell.fps,
    audio: cell.audio,
  });
}

/** Build the GenSpendInput a gen cell will hand startGen — the SAME shape
 *  pricedGenCredits + startGen reserve on, so quote == reserve. PURE. */
function cellSpendInput(cell: GenCell): GenSpendInput {
  const material = cellMaterial(cell);
  return {
    kind: material.kind,
    model: material.model,
    count: material.count,
    referenceVideoGenerationId: material.referenceVideoGenerationId,
    videoOptions: material.videoOptions,
  };
}

/** Per-cell shape/model validity — mirrors genRequest's model-menu check (defence in depth;
 *  genRequest inside startGen stays the authoritative (model,params) spend gate). Returns an
 *  error message for an invalid cell, else null. A video cell whose model isn't a real video
 *  model is the case that would otherwise crash videoDefaults — catching it here turns a
 *  mid-loop throw into a clean per-cell error. Reuses core's closed model sets (NOT price config). */
function genCellError(cell: GenCell): string | null {
  const kind = cell.kind ?? "image";
  const model = cell.model ?? "seedream";
  const menu: readonly string[] = kind === "video" ? GEN_VIDEO_MODELS : GEN_MODELS;
  if (!menu.includes(model)) {
    return kind === "video"
      ? `"${model}" isn't a valid video model — pick a supported one.`
      : `"${model}" isn't a valid image model — pick a supported one.`;
  }
  return null;
}

/** The per-cell quote in internal credits. Same authority as startGen's reserve
 *  (pricedGenCredits) — never a batch-level constant. NEVER throws for a schema-allowed cell:
 *  an invalid (e.g. bad/absent video model) cell can't be priced and returns 0 — orchestrateBatch
 *  turns it into a per-cell error (it is never dispatched, so 0 is never charged). */
export function quoteCell(cell: BatchCell): number {
  if (cell.type === "text") return 0;
  if (genCellError(cell)) return 0;
  return pricedGenCredits(cellSpendInput(cell));
}

/** Stable ids are domain-separated and length-delimited before the existing helper hashes them. */
function stableCellScope(batchId: string, stableId: string): string {
  return `factory-entry-v1:${batchId.length}:${batchId}:${stableId.length}:${stableId}`;
}

/** The logical (attempt-independent) key prefix a stable-id cell dispatches under.
 *
 *  Exported because "has this durable id already been dispatched — and therefore already
 *  reserved credits?" is a question callers legitimately need to ask BEFORE offering an action
 *  that would rewrite the plan behind paid work (#712's undo). One derivation, two readers:
 *  a second hand-written copy of this formula would go stale silently and the reader would
 *  answer "never dispatched" for work that really was charged. */
export function stableCellLogicalPrefix(batchId: string, stableId: string): string {
  return factoryLogicalPrefix(stableCellScope(batchId, stableId), 0);
}

/**
 * 这个格**真会跑的那份完整规格**(#709;#709 修复轮 P1-2 从 video-only 扩到整份)——
 * `normalizeFactoryMaterial` 解析默认值之后的结果,也正是落进 `GenJob.videoOptions` /
 * `GenJob.imageOptions` 的那份快照、`pricedGenCredits` 拿去算钱的那份输入。
 *
 * 卡面报规格必须读它,而不是读 `cell` 上那几个可能为空的字段:名字没说形状的片子格式
 * (`video`)在 cell 上根本没有 aspectRatio,照 cell 显示就是「一个规格字段都不显示」——
 * 那正是 #709 的现象。
 *
 * 它是**一整份**,不是挑出来的几个字段:卡面说得出口的每一项都在里面,承诺面因此可以
 * 被整份哈希(见 campaign-generation-confirm 的内容指纹)。挑字段的那一版漏掉了 audio
 * 与解析后的默认画幅 —— 同模型同价下声音或画幅一变,旧指纹照样通过(判官 r1 P1-2)。
 */
export interface CellResolvedSpec {
  /** 解析后的画幅 —— 视频读 videoOptions,图片读 imageOptions。永远有值。 */
  aspectRatio: string;
  count: number;
  /** 以下只有视频有。字段名与 `buildSpecChips` 的入参同名,卡面因此不做第二次翻译。 */
  resolution?: string;
  durationSeconds?: number;
  fps?: number;
  audio?: boolean;
}

/** 这个格解析之后真会跑的整份规格。PURE。 */
export function cellResolvedSpec(cell: GenCell): CellResolvedSpec {
  const material = cellMaterial(cell);
  const video = material.videoOptions;
  if (video) {
    return {
      aspectRatio: video.aspectRatio,
      count: material.count,
      resolution: video.resolution,
      durationSeconds: video.seconds,
      fps: video.fps,
      audio: video.audio,
    };
  }
  // 图片:`normalizeFactoryMaterial` 对 IMAGE 一定给得出 imageOptions(缺省 = 模型默认方图)。
  return {
    aspectRatio: material.imageOptions?.aspectRatio ?? imageDefaults(material.model as GenModel).aspectRatio,
    count: material.count,
  };
}

/** 一个格这一趟的收费预判。`new` 会被收 `credits`;`reused` / `blocked` 收 0。 */
export interface CellChargePreview {
  index: number;
  disposition: "new" | "reused" | "blocked" | "text";
  /** 这一趟真会被预扣的内部 credits —— reused / blocked / text 一律 0。 */
  credits: number;
  /**
   * 只有 `reused` 有值:被复用的那一单**做完没有**(#708 修复轮 P2-1)。
   *
   * 复用只说明「不再收钱」,不说明「已经做好」—— 判据把 QUEUED / GENERATING / DONE 都算
   * 复用。卡面照这一格说话,于是一单还在跑的片子不会被写成已完成。判据与收费判据同源:
   * 同一份历史、同一个 `factoryReusedPrior`。
   */
  reuseState?: "in_progress" | "done";
}

export interface BatchChargePreview {
  cells: CellChargePreview[];
  /** 只把 `new` 的格加起来 —— 这就是确认下去真会离开余额的那个数。 */
  totalCredits: number;
}

/**
 * 确认之前,如实预判这一批**真会收多少钱**(#708)。READ-only、$0:不建任务、不预扣、
 * 不叫 provider,只读 owner+project 范围内的历史行。
 *
 * 为什么它必须住在这里:身份解析(稳定 id / 迁移期位置键)与材料比对是 `orchestrateBatch`
 * 派发时走的那一套,报价若自己另写一套,就会再一次「说的与做的分家」。这里复用的是
 * **同一个** `prepareStableCellPlan` + `cellMaterial` + `factoryHistoryDisposition`。
 *
 * 它**不是**预扣授权:startGen 在项目锁里重判一次,那一次才算数。所以预判与真实结果之间
 * 的竞态(报价后那一单恰好失败/完成)不会让钱出错 —— 调用方拿报价总额与确认时重算的总额
 * 对签,对不上就 fail closed 让商家重看。
 */
export async function previewBatchCharges(
  db: Pick<PrismaClient, "genJob">,
  args: OrchestrateArgs,
): Promise<BatchChargePreview | { error: string }> {
  const prepared = await prepareStableCellPlan(db, args);
  if ("error" in prepared) return prepared;

  const cells: CellChargePreview[] = [];
  for (let i = 0; i < args.cells.length; i++) {
    const cell = args.cells[i];
    if (cell.type === "text") {
      cells.push({ index: i, disposition: "text", credits: 0 });
      continue;
    }
    if (genCellError(cell)) {
      cells.push({ index: i, disposition: "blocked", credits: 0 });
      continue;
    }
    const identity = prepared.identityByIndex.get(i) ?? factoryAttemptKey(args.batchId, i, args.attemptId);
    const history = prepared.historyByIndex.get(i) ?? (await db.genJob.findMany({
      where: {
        ownerId: args.ownerId,
        projectId: args.projectId,
        idempotencyKey: { startsWith: identity.logicalPrefix },
      },
      orderBy: { createdAt: "desc" },
      select: FACTORY_HISTORY_SELECT,
    }) as FactoryHistoryRow[]);
    const expected = cellMaterial(cell, args.threadId);
    const disposition = factoryHistoryDisposition(history, expected);
    if (disposition === "fresh") cells.push({ index: i, disposition: "new", credits: quoteCell(cell) });
    else if (disposition === "reused") {
      // #708 修复轮 P2-1:复用的是**哪一单**,决定卡面能不能说「已经做好了」。
      // 同一份历史、同一条判据 —— 不再新写一套「做完没有」的规则。
      const prior = factoryReusedPrior(history, expected);
      cells.push({
        index: i,
        disposition: "reused",
        credits: 0,
        reuseState: prior?.status === "DONE" ? "done" : "in_progress",
      });
    } else cells.push({ index: i, disposition: "blocked", credits: 0 });
  }
  return { cells, totalCredits: cells.reduce((sum, cell) => sum + cell.credits, 0) };
}

/** The persisted key is still the reserved 79-char factory family parsed by startGen. */
function stableCellAttemptKey(args: OrchestrateArgs, cell: GenCell): FactoryAttemptKey {
  return factoryAttemptKey(stableCellScope(args.batchId, cell.idempotencyId as string), 0, args.attemptId);
}

interface StableCellPlan {
  identityByIndex: Map<number, FactoryAttemptKey>;
  historyByIndex: Map<number, FactoryHistoryRow[]>;
}

/** Resolve stable and pre-migration positional identities before any dispatch. Reads are routing
 *  only; every selected identity still goes through startGen's owner/project lock-time verdict. */
async function prepareStableCellPlan(
  db: Pick<PrismaClient, "genJob">,
  args: OrchestrateArgs,
): Promise<StableCellPlan | { error: string }> {
  const stableCells = args.cells
    .map((cell, index) => ({ cell, index }))
    .filter((item): item is { cell: GenCell; index: number } => item.cell.type === "gen");
  if (stableCells.length === 0 || stableCells.every(({ cell }) => cell.idempotencyId == null)) {
    return { identityByIndex: new Map(), historyByIndex: new Map() };
  }

  if (stableCells.some(({ cell }) => cell.idempotencyId == null)) {
    return { error: "Every generated cell needs a stable id when stable idempotency is enabled." };
  }

  const stableIdentities = new Map(
    stableCells.map(({ cell, index }) => [index, stableCellAttemptKey(args, cell)]),
  );
  const legacyIdentities = Array.from(
    { length: MAX_BATCH_CELLS },
    (_, index) => ({ index, identity: factoryAttemptKey(args.batchId, index, args.attemptId) }),
  );
  const prefixes = [
    ...new Set([
      ...[...stableIdentities.values()].map((identity) => identity.logicalPrefix),
      ...legacyIdentities.map(({ identity }) => identity.logicalPrefix),
    ]),
  ];

  const history = await db.genJob.findMany({
    where: {
      ownerId: args.ownerId,
      projectId: args.projectId,
      OR: prefixes.map((prefix) => ({ idempotencyKey: { startsWith: prefix } })),
    },
    orderBy: { createdAt: "desc" },
    select: FACTORY_HISTORY_SELECT,
  }) as FactoryHistoryRow[];

  const historyByPrefix = new Map(
    prefixes.map((prefix) => [
      prefix,
      history.filter((row) => row.idempotencyKey?.startsWith(prefix)),
    ]),
  );
  const legacyWithHistory = legacyIdentities.filter(
    ({ identity }) => (historyByPrefix.get(identity.logicalPrefix)?.length ?? 0) > 0,
  );
  const usedLegacyIndexes = new Set<number>();
  const identityByIndex = new Map<number, FactoryAttemptKey>();
  const historyByIndex = new Map<number, FactoryHistoryRow[]>();
  const unmatched: Array<{ cell: GenCell; index: number }> = [];

  // Sorting by durable id makes duplicate-material migration assignment independent of current
  // array order. Duplicate ids were rejected before this read.
  for (const item of [...stableCells].sort((a, b) => {
    const left = a.cell.idempotencyId as string;
    const right = b.cell.idempotencyId as string;
    return left < right ? -1 : left > right ? 1 : 0;
  })) {
    const stableIdentity = stableIdentities.get(item.index) as FactoryAttemptKey;
    const stableHistory = historyByPrefix.get(stableIdentity.logicalPrefix) ?? [];
    if (stableHistory.length > 0) {
      identityByIndex.set(item.index, stableIdentity);
      historyByIndex.set(item.index, stableHistory);
      continue;
    }

    const expected = cellMaterial(item.cell, args.threadId);
    const legacy = legacyWithHistory.find(({ index, identity }) => {
      if (usedLegacyIndexes.has(index)) return false;
      const rows = historyByPrefix.get(identity.logicalPrefix) ?? [];
      return rows.length > 0 && rows.every((row) => factoryMaterialMatches(row, expected));
    });
    if (!legacy) {
      unmatched.push(item);
      continue;
    }

    usedLegacyIndexes.add(legacy.index);
    identityByIndex.set(item.index, legacy.identity);
    historyByIndex.set(item.index, historyByPrefix.get(legacy.identity.logicalPrefix) ?? []);
  }

  // Old positional rows do not contain entry ids. Once ANY such history exists, an unmatched
  // current cell could be an edited old entry; minting a new stable key could re-charge it.
  if (legacyWithHistory.length > 0 && unmatched.length > 0) {
    return {
      error: "This existing batch cannot safely match every plan entry. Use the original approved content or choose a different project.",
    };
  }

  // A batch with zero positional history is new: unmatched cells safely start on stable ids.
  for (const item of unmatched) {
    const stableIdentity = stableIdentities.get(item.index) as FactoryAttemptKey;
    identityByIndex.set(item.index, stableIdentity);
    historyByIndex.set(item.index, []);
  }

  return { identityByIndex, historyByIndex };
}

/** Assemble the genRequest a cell hands startGen. Identity selection (stable/legacy/positional)
 *  is resolved separately, but all forms remain the parsed factory family. */
function cellGenRequest(
  cell: GenCell,
  args: OrchestrateArgs,
  idempotencyKey: string,
): Record<string, unknown> {
  const req: Record<string, unknown> = {
    projectId: args.projectId,
    prompt: cell.prompt,
    entityIds: cell.entityIds ?? [],
    count: cell.kind === "video" ? 1 : cell.count ?? 1,
    kind: cell.kind ?? "image",
    model: cell.model ?? "seedream",
    idempotencyKey,
  };
  if (args.threadId) req.threadId = args.threadId;
  if (cell.shotId) req.shotId = cell.shotId;
  if (cell.sourceGenerationId) req.sourceGenerationId = cell.sourceGenerationId;
  if (cell.tailGenerationId) req.tailGenerationId = cell.tailGenerationId;
  if (cell.referenceVideoGenerationId) req.referenceVideoGenerationId = cell.referenceVideoGenerationId;
  if (cell.variantSel) req.variantSel = cell.variantSel;
  if (cell.durationSeconds != null) req.durationSeconds = cell.durationSeconds;
  if (cell.resolution != null) req.resolution = cell.resolution;
  if (cell.aspectRatio != null) req.aspectRatio = cell.aspectRatio;
  if (cell.fps != null) req.fps = cell.fps;
  if (cell.audio != null) req.audio = cell.audio;
  return req;
}

function summarizeBatch(batchId: string, cells: CellResult[]): BatchResult {
  const totalCredits = cells.reduce((sum, cell) => sum + cell.credits, 0);
  return {
    batchId,
    cells,
    totalCredits,
    dispatched: cells.filter((cell) => cell.status === "queued").length,
    reused: cells.filter((cell) => cell.status === "reused").length,
    failed: cells.filter((cell) => cell.status === "error").length,
  };
}

function interruptedBatch(
  args: OrchestrateArgs,
  cells: CellResult[],
  atIndex: number,
  current: BatchInterruption["current"],
  error: string,
): BatchFailure {
  return {
    error,
    partial: {
      partial: summarizeBatch(args.batchId, cells),
      atIndex,
      current,
      notStarted: args.cells.length - atIndex - (current === "unknown" ? 1 : 0),
    },
  };
}

/**
 * Orchestrate one batch. Headless: dispatches every cell through startGen (or skips
 * text cells at $0), groups the resulting jobs under a GenerationBatch, and returns
 * the per-cell quotes + dispatch outcomes. Does NOT wait for generation to finish and
 * does NOT touch credits.
 */
export async function orchestrateBatch(
  deps: OrchestrateDeps,
  args: OrchestrateArgs,
): Promise<BatchResult | BatchFailure> {
  if (args.cells.length === 0) return { error: "A batch needs at least one cell." };
  if (args.cells.length > MAX_BATCH_CELLS) {
    return { error: `A batch can have at most ${MAX_BATCH_CELLS} cells.` };
  }
  // Shape guard (defence in depth — genRequest is still the spend authority per cell).
  const stableIds = new Set<string>();
  for (const cell of args.cells) {
    if (cell.type === "gen") {
      if (!cell.prompt || cell.prompt.length > MAX_PROMPT) return { error: "A cell prompt is out of bounds." };
      if (cell.idempotencyId != null) {
        if (cell.idempotencyId.length < 1 || cell.idempotencyId.length > MAX_ID) {
          return { error: "A stable cell id is out of bounds." };
        }
        if (stableIds.has(cell.idempotencyId)) return { error: "Stable cell ids must be unique." };
        stableIds.add(cell.idempotencyId);
      }
    } else if (cell.type === "text") {
      if (!cell.text || cell.text.length > MAX_PROMPT) return { error: "A text cell is out of bounds." };
    } else {
      return { error: "Unknown cell type." };
    }
  }
  if (args.batchId.length < 1 || args.batchId.length > MAX_ID) return { error: "Invalid batch id." };
  if (args.attemptId.length < 1 || args.attemptId.length > MAX_ID) return { error: "Invalid attempt id." };

  let stablePlan: StableCellPlan;
  try {
    const prepared = await prepareStableCellPlan(deps.prisma, args);
    if ("error" in prepared) return prepared;
    stablePlan = prepared;
  } catch (error) {
    console.warn(
      "factory-batch: stable history check failed before dispatch:",
      error instanceof Error ? error.message : error,
    );
    return interruptedBatch(
      args,
      [],
      0,
      "not_started",
      "The batch could not start because its history could not be checked safely.",
    );
  }

  // Resolve-or-create the grouping row, owner-scoped. No paid cell has started yet.
  let batch: { id: string } | { error: string };
  try {
    batch = await resolveOrCreateBatch(deps.prisma, args);
  } catch (error) {
    console.warn(
      "factory-batch: batch grouping could not be resolved before dispatch:",
      error instanceof Error ? error.message : error,
    );
    return interruptedBatch(args, [], 0, "not_started", "The batch could not start safely.");
  }
  if ("error" in batch) return batch;

  const cells: CellResult[] = [];
  // Sequential dispatch: startGen only ENQUEUES (reserve + boss.send) and returns
  // immediately — it never blocks on generation — so a for-loop enqueues all cells
  // promptly and the worker pool runs them in parallel. The batch never polls for a
  // cell to finish before dispatching the next (that is what "不串行阻塞" forbids).
  for (let i = 0; i < args.cells.length; i++) {
    const cell = args.cells[i];
    if (cell.type === "text") {
      cells.push({ index: i, type: "text", status: "text", credits: 0 });
      continue;
    }

    // Per-cell validity precheck (defence in depth; genRequest inside startGen stays the
    // authority). A THROW here would abandon the cells already dispatched (+ charged) with no
    // BatchResult, so a bad cell must become a clean per-cell error, never an exception.
    const invalid = genCellError(cell);
    if (invalid) {
      cells.push({ index: i, type: "gen", status: "error", credits: 0, error: invalid });
      continue;
    }

    // Read-only early reject: content drift can fail before entering startGen, but this read is
    // NEVER the reserve/reuse authority. startGen repeats the same full binding and disposition
    // decision under the owner/project advisory transaction lock, closing every concurrency gap.
    const identity = stablePlan.identityByIndex.get(i) ?? factoryAttemptKey(args.batchId, i, args.attemptId);
    const expectedMaterial = cellMaterial(cell, args.threadId);
    let history = stablePlan.historyByIndex.get(i);
    if (!history) {
      try {
        history = await deps.prisma.genJob.findMany({
          where: {
            ownerId: args.ownerId,
            projectId: args.projectId,
            idempotencyKey: { startsWith: identity.logicalPrefix },
          },
          orderBy: { createdAt: "desc" },
          select: FACTORY_HISTORY_SELECT,
        }) as FactoryHistoryRow[];
      } catch (error) {
        console.warn(
          `factory-batch: history check failed before cell ${i} dispatch:`,
          error instanceof Error ? error.message : error,
        );
        return interruptedBatch(
          args,
          cells,
          i,
          "not_started",
          "The batch stopped before every item could be checked safely.",
        );
      }
    }
    if (history.some((prior) => !factoryMaterialMatches(prior, expectedMaterial))) {
      cells.push({
        index: i,
        type: "gen",
        status: "error",
        credits: 0,
        error: "That batchId is already in use for different content — start a new batch with a fresh id.",
      });
      continue;
    }

    let res: Awaited<ReturnType<StartGenPort>>;
    try {
      res = await deps.startGen(cellGenRequest(cell, args, identity.key), i);
    } catch (error) {
      // startGen already reconciles a lost transaction ACK by keyed lookup. If it still throws,
      // the current cell's commit state is genuinely unknown; do not label it uncharged.
      console.warn(
        `factory-batch: start status unknown for cell ${i}:`,
        error instanceof Error ? error.message : error,
      );
      return interruptedBatch(
        args,
        cells,
        i,
        "unknown",
        "The batch stopped while an item's start status was being confirmed.",
      );
    }
    if ("error" in res) {
      cells.push({ index: i, type: "gen", status: "error", credits: 0, error: res.error });
      continue;
    }
    await tagJobToBatch(deps.prisma, args.ownerId, res.id, args.batchId);
    if (res.disposition === "fresh") {
      cells.push({ index: i, type: "gen", status: "queued", jobId: res.id, credits: quoteCell(cell) });
    } else {
      cells.push({ index: i, type: "gen", status: "reused", jobId: res.id, credits: 0 });
    }
  }

  return summarizeBatch(args.batchId, cells);
}

async function resolveOrCreateBatch(
  db: Pick<PrismaClient, "generationBatch">,
  args: OrchestrateArgs,
): Promise<{ id: string } | { error: string }> {
  const existing = await db.generationBatch.findFirst({
    where: { id: args.batchId, ownerId: args.ownerId },
    select: { id: true },
  });
  if (existing) return existing;
  try {
    return await db.generationBatch.create({
      data: {
        id: args.batchId,
        ownerId: args.ownerId,
        projectId: args.projectId,
        name: args.name ?? "Batch",
      },
      select: { id: true },
    });
  } catch (e) {
    // A concurrent same-batchId create (or a cross-tenant id collision) → re-read
    // owner-scoped; if it's ours use it, else refuse (fail closed, no spend yet).
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const again = await db.generationBatch.findFirst({
        where: { id: args.batchId, ownerId: args.ownerId },
        select: { id: true },
      });
      if (again) return again;
      return { error: "That batch id is unavailable." };
    }
    throw e;
  }
}

async function tagJobToBatch(
  db: Pick<PrismaClient, "genJob">,
  ownerId: string,
  jobId: string,
  batchId: string,
): Promise<void> {
  try {
    await db.genJob.updateMany({ where: { id: jobId, ownerId }, data: { batchId } });
  } catch (e) {
    // Grouping is best-effort metadata: the job is already created + reserved + queued
    // inside startGen, so a failed batchId write must NOT surface as a cell error.
    console.warn(`factory-batch: batchId tag failed for job ${jobId} (non-fatal):`, e instanceof Error ? e.message : e);
  }
}

/** Rollup for a batch: read the grouped jobs' live statuses and count them.
 *
 *  Every GenStatus gets its own line, `cancelled` included (#602 T3) — a rollup where the parts
 *  do not add up to `total` is a rollup that cannot be read. While cancelling wrote FAILED, a
 *  cancelled cell was counted as a failure; unnamed, it would have vanished from the counts
 *  instead, which is the same problem wearing the opposite face. */
export interface BatchStatus {
  batchId: string;
  /** GenJob status counts among the batch's grouped jobs. */
  queued: number;
  generating: number;
  done: number;
  failed: number;
  cancelled: number;
  total: number;
}

export async function batchCellStatuses(
  db: Pick<PrismaClient, "genJob">,
  ownerId: string,
  batchId: string,
): Promise<BatchStatus> {
  const jobs = await db.genJob.findMany({
    where: { ownerId, batchId },
    select: { status: true },
  });
  const count = (status: string) => jobs.filter((job) => job.status === status).length;
  return {
    batchId,
    queued: count("QUEUED"),
    generating: count("GENERATING"),
    done: count("DONE"),
    failed: count("FAILED"),
    cancelled: count("CANCELLED"),
    total: jobs.length,
  };
}
