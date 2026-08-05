import { createHash } from "node:crypto";
import {
  canvasMaterialWithoutRepair,
  imageDefaults,
  videoDefaults,
  type GenModel,
  type GenVideoModel,
} from "@fikirtive/core";

const HASH_HEX_LENGTH = 32;
const FACTORY_KEY_RE = /^batch:([0-9a-f]{32}):attempt:([0-9a-f]{32})$/;
const CANVAS_KEY_RE = /^canvas:([0-9a-f]{64})$/;

export interface CanvasActionKey {
  key: string;
}

export interface FactoryAttemptKey {
  key: string;
  logicalPrefix: string;
}

export interface FactoryVideoOptions extends Record<string, string | number | boolean> {
  seconds: number;
  resolution: string;
  aspectRatio: string;
  fps: number;
  audio: boolean;
}

/** #642: the image shape frozen at enqueue — mirrors FactoryVideoOptions. */
export interface FactoryImageOptions extends Record<string, string> {
  aspectRatio: string;
}

export interface FactoryMaterial {
  prompt: string;
  model: string;
  kind: "IMAGE" | "VIDEO";
  count: number;
  entityIds: string[];
  variantSel: Record<string, string> | null;
  sourceGenerationId: string | null;
  tailGenerationId: string | null;
  referenceVideoGenerationId: string | null;
  shotId: string | null;
  threadId: string | null;
  videoOptions: FactoryVideoOptions | null;
  imageOptions: FactoryImageOptions | null;
}

export interface FactoryMaterialInput {
  prompt: string;
  model: string;
  kind: "image" | "video";
  count: number;
  entityIds?: string[];
  variantSel?: Record<string, string>;
  sourceGenerationId?: string | null;
  tailGenerationId?: string | null;
  referenceVideoGenerationId?: string | null;
  shotId?: string | null;
  threadId?: string | null;
  durationSeconds?: number | null;
  resolution?: string | null;
  aspectRatio?: string | null;
  fps?: number | null;
  audio?: boolean | null;
}

export type StoredFactoryMaterial = Omit<FactoryMaterial, "videoOptions" | "imageOptions" | "variantSel" | "threadId"> & {
  /** The database row whose repair record is allowed to describe this material. */
  id: string;
  variantSel: unknown;
  videoOptions: unknown;
  /** Legacy/non-Canvas readers may omit the column; absence is the same as null. */
  threadId?: string | null;
  /** #642: rows enqueued before the column existed have no value; absence is the same as
   *  null, which canonicalizes to the default (square) shape those rows really produced. */
  imageOptions?: unknown;
};

function shortHash(scope: string, value: string): string {
  return createHash("sha256")
    .update(scope)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, HASH_HEX_LENGTH);
}

/** Reserved, server-derived Canvas action identity. The full SHA-256 digest keeps the key
 * inside genRequest's 80-character cap while never persisting the caller's action id. */
export function canvasActionKey(actionId: string): CanvasActionKey {
  const digest = createHash("sha256")
    .update("canvas-action-v1")
    .update("\0")
    .update(`${actionId.length}:${actionId}`)
    .digest("hex");
  return { key: `canvas:${digest}` };
}

/** Recognises only the reserved v1 Canvas family. startGen refuses caller-supplied members;
 * startCanvasGen is the only entrypoint allowed to derive one server-side. */
export function parseCanvasActionKey(key: string): CanvasActionKey | null {
  return CANVAS_KEY_RE.test(key) ? { key } : null;
}

/** Stable factory identity: 128-bit logical-cell hash + 128-bit caller attempt hash.
 *  The resulting key is exactly 79 characters, inside genRequest's 80-character cap. */
export function factoryAttemptKey(batchId: string, cellIndex: number, attemptId: string): FactoryAttemptKey {
  const logicalHash = shortHash("factory-cell-v1", `${batchId.length}:${batchId}:${cellIndex}`);
  const attemptHash = shortHash("factory-attempt-v1", `${attemptId.length}:${attemptId}`);
  const logicalPrefix = `batch:${logicalHash}:attempt:`;
  return { key: `${logicalPrefix}${attemptHash}`, logicalPrefix };
}

/** Recognises only the v1 structural factory key; legacy/general/cowork keys stay on their
 *  existing startGen semantics. */
export function parseFactoryAttemptKey(key: string): FactoryAttemptKey | null {
  const match = FACTORY_KEY_RE.exec(key);
  if (!match) return null;
  return { key, logicalPrefix: `batch:${match[1]}:attempt:` };
}

function canonicalVariantSel(value: Record<string, string> | null | undefined): Record<string, string> | null;
function canonicalVariantSel(value: unknown): unknown;
function canonicalVariantSel(value: unknown): unknown {
  if (value == null) return null;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) return null;
  return value;
}

/** The exact shape startGen persists, shared by its lock-time binding and factory's early reject. */
export function normalizeFactoryMaterial(input: FactoryMaterialInput): FactoryMaterial {
  const videoOptions: FactoryVideoOptions | null = (() => {
    if (input.kind !== "video") return null;
    const defaults = videoDefaults(input.model as GenVideoModel);
    return {
      seconds: input.durationSeconds ?? defaults.seconds,
      resolution: input.resolution ?? defaults.resolution,
      aspectRatio: input.aspectRatio ?? defaults.aspectRatio,
      fps: input.fps ?? defaults.fps,
      audio: input.audio ?? defaults.audio,
    };
  })();

  // #642: the image shape, resolved once here so the persisted snapshot, the money
  // material binding, and the worker's provider call all read the same value. Absent →
  // the model's default (1:1), which is byte-for-byte what image jobs produced before.
  const imageOptions: FactoryImageOptions | null = input.kind === "image"
    ? { aspectRatio: input.aspectRatio ?? imageDefaults(input.model as GenModel).aspectRatio }
    : null;

  return {
    prompt: input.prompt,
    model: input.model,
    kind: input.kind === "video" ? "VIDEO" : "IMAGE",
    count: input.kind === "video" ? 1 : input.count,
    entityIds: input.entityIds ?? [],
    variantSel: input.kind === "video" ? null : canonicalVariantSel(input.variantSel),
    sourceGenerationId: input.sourceGenerationId ?? null,
    tailGenerationId: input.tailGenerationId ?? null,
    referenceVideoGenerationId: input.referenceVideoGenerationId ?? null,
    shotId: input.shotId ?? null,
    threadId: input.threadId ?? null,
    videoOptions,
    imageOptions,
  };
}

/**
 * The EXACT column set `factoryMaterialMatches` reads, as one Prisma projection.
 *
 * 它住在比对器旁边,是因为两者必须同生共死:投影漏掉哪一列,Prisma 结果里那一列就
 * **根本不存在**,比对器只能按缺省解释它 —— 于是「同一个请求」被判成「不同内容」,
 * 商家的重试被永久拒绝(方向安全,但功能坏掉)。#642 修复轮 r1 P1 就是这么发生的:
 * 这份清单当时有两份手抄副本(startGen 一份、工厂批量一份),新增的规格列只补进了一份。
 *
 * 一份清单,两个读者。加一列只需要改这里一处。
 */
export const FACTORY_HISTORY_SELECT = {
  id: true,
  status: true,
  idempotencyKey: true,
  prompt: true,
  model: true,
  kind: true,
  count: true,
  entityIds: true,
  variantSel: true,
  sourceGenerationId: true,
  tailGenerationId: true,
  referenceVideoGenerationId: true,
  shotId: true,
  threadId: true,
  videoOptions: true,
  imageOptions: true,
} as const;

/** A history row read through FACTORY_HISTORY_SELECT. */
export type FactoryHistoryRow = StoredFactoryMaterial & {
  id: string;
  status: string;
  idempotencyKey: string | null;
};

/** #642 legacy equivalence. An IMAGE row enqueued before the shape column existed carries
 *  null — and those runs really did produce the default square, so null and an explicit
 *  default shape are the SAME material. Without this, every pre-migration attempt replay
 *  would read as a material conflict (an idempotency regression, not a shape change). */
function canonicalImageOptions(value: unknown, kind: "IMAGE" | "VIDEO"): unknown {
  if (kind !== "IMAGE") return null;
  if (value == null) return { aspectRatio: imageDefaults("seedream").aspectRatio };
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Full material binding. FAILED rows are deliberately not special: status never weakens content
 *  identity. entityIds are order-sensitive and preserve duplicates because the worker consumes
 *  them in order; JSON object key order is irrelevant. */
export function factoryMaterialMatches(prior: StoredFactoryMaterial, expected: FactoryMaterial): boolean {
  if (typeof prior.id !== "string" || prior.id.length === 0) return false;
  return (
    prior.prompt === expected.prompt &&
    prior.model === expected.model &&
    prior.kind === expected.kind &&
    prior.count === expected.count &&
    canonicalJson(prior.entityIds) === canonicalJson(expected.entityIds) &&
    canonicalJson(canonicalVariantSel(prior.variantSel)) === canonicalJson(canonicalVariantSel(expected.variantSel)) &&
    prior.sourceGenerationId === expected.sourceGenerationId &&
    prior.tailGenerationId === expected.tailGenerationId &&
    prior.referenceVideoGenerationId === expected.referenceVideoGenerationId &&
    prior.shotId === expected.shotId &&
    (prior.threadId ?? null) === expected.threadId &&
    canonicalJson(canvasMaterialWithoutRepair(prior.videoOptions, prior.id)) ===
      canonicalJson(canvasMaterialWithoutRepair(expected.videoOptions, prior.id)) &&
    // kind equality is asserted above, so both sides canonicalize under the same kind.
    canonicalJson(canonicalImageOptions(prior.imageOptions, expected.kind)) ===
      canonicalJson(canonicalImageOptions(expected.imageOptions, expected.kind))
  );
}
