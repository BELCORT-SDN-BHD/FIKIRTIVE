/**
 * canvas-lineage — "where did this card come from?", in the merchant's own words.
 *
 * Pure shaping only: no database, no spend, no I/O. The server reads the owner-scoped rows
 * (canvas-actions / otto-canvas-bridge) and hands them here; the canvas renders the result.
 *
 * FOUNDER RULE — 每个东西都要有迹可循 ("everything must be traceable"): a card kept only its
 * prompt, so a merchant could not tell when it was made, what it was made with, what it cost,
 * or which card it came from (#547 B4). This module adds those four, and only those four.
 *
 * FOUNDER RULE — the generation engine is confidential: nothing here ever carries a model or
 * provider name. Settings are the merchant-visible shape of the output (seconds, resolution,
 * aspect, batch position), never the engine that produced it. Provider-secrecy behavior tests
 * enforce the same rule.
 */

import { creditsLabel } from "./credit-format";

/** Output settings worth showing a merchant. Video-only fields stay null for images. */
export type CanvasNodeSettings = {
  durationSeconds: number | null;
  resolution: string | null;
  aspectRatio: string | null;
};

/** The traceability record carried by every generated canvas card. */
export type CanvasNodeLineage = {
  /** When the card's asset was produced, pre-formatted in the merchant's workspace timezone. */
  madeAtLabel: string | null;
  settings: CanvasNodeSettings;
  /** Displayed credits charged for the paid job behind this card; null when not known. */
  costCredits: number | null;
  /**
   * How many cards that one paid job produced (1 for a single image or a video).
   *
   * Read straight off the card's own recorded `batchSize` (#603 T4) — what the merchant BOUGHT,
   * not how many of them are still on the board. 1 also stands for "not known", which is how a
   * card whose paid job no longer exists reads: it simply says nothing about a batch.
   */
  batchSize: number;
  /** 1-based position of this card inside its batch; null when it was never recorded. */
  batchPosition: number | null;
};

/**
 * Read a GenJob.videoOptions JSON blob defensively — it is untyped at the database edge.
 *
 * The stored key is `seconds` (see `normalizeFactoryMaterial`, which is what startGen persists,
 * and the worker, which prices and renders from the same key). This module originally read
 * `durationSeconds`, a name that exists only on the REQUEST — so every real video card silently
 * lost its length and showed "720p · 16:9" with no duration at all. `durationSeconds` is still
 * accepted second so nothing that ever did store it loses its record.
 */
export function canvasVideoSettings(videoOptions: unknown): CanvasNodeSettings {
  const empty: CanvasNodeSettings = { durationSeconds: null, resolution: null, aspectRatio: null };
  if (videoOptions === null || typeof videoOptions !== "object" || Array.isArray(videoOptions)) return empty;
  const record = videoOptions as Record<string, unknown>;
  const duration = typeof record.seconds === "number" ? record.seconds : record.durationSeconds;
  const resolution = record.resolution;
  const aspectRatio = record.aspectRatio;
  return {
    durationSeconds:
      typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null,
    resolution: typeof resolution === "string" && resolution ? resolution : null,
    aspectRatio: typeof aspectRatio === "string" && aspectRatio ? aspectRatio : null,
  };
}

/**
 * #643 T2 —— 一张图当初是按什么形状交付的，读它自己的规格快照（`GenJob.imageOptions`）。
 *
 * 为什么不从像素反推：反推出来的是一个**看起来像事实**的推断值。快照读不到（T1 之前的老图）
 * 就是 null，卡面据此什么都不说 —— 这比说一个可能不对的比例诚实。
 */
export function canvasImageSettings(imageOptions: unknown): CanvasNodeSettings {
  const empty: CanvasNodeSettings = { durationSeconds: null, resolution: null, aspectRatio: null };
  if (imageOptions === null || typeof imageOptions !== "object" || Array.isArray(imageOptions)) return empty;
  const aspectRatio = (imageOptions as Record<string, unknown>).aspectRatio;
  return {
    ...empty,
    aspectRatio: typeof aspectRatio === "string" && aspectRatio ? aspectRatio : null,
  };
}

/** "5s · 720p · 16:9", or "" when nothing is known — never a guess and never an engine name. */
export function canvasSettingsLabel(settings: CanvasNodeSettings): string {
  const parts = [
    settings.durationSeconds === null ? null : `${settings.durationSeconds}s`,
    settings.resolution,
    settings.aspectRatio,
  ].filter((part): part is string => !!part);
  return parts.join(" · ");
}

/** "Image 2 of 4" — a batch card says which of the batch it is; a lone card says nothing. */
export function canvasBatchLabel(lineage: Pick<CanvasNodeLineage, "batchSize" | "batchPosition">): string {
  if (lineage.batchSize <= 1 || lineage.batchPosition === null) return "";
  return `Image ${lineage.batchPosition} of ${lineage.batchSize}`;
}

/**
 * What this card cost, said the way the ledger actually charged it.
 *
 * A batch is ONE charge for N cards, so a 4-image batch must not print "4 credits" on each
 * card as if it had been billed four times. Display only — the number comes from the ledger
 * read, never from a price literal here.
 */
export function canvasCostLabel(lineage: Pick<CanvasNodeLineage, "costCredits" | "batchSize">): string {
  if (lineage.costCredits === null) return "Cost not recorded";
  if (lineage.costCredits === 0) return "No charge";
  if (lineage.batchSize > 1) return `${creditsLabel(lineage.costCredits)} for this batch of ${lineage.batchSize}`;
  return creditsLabel(lineage.costCredits);
}

/** Merchant-facing lineage rows, in display order. Empty values are dropped, never faked. */
export function canvasLineageRows(
  lineage: CanvasNodeLineage,
  options: { hasSource?: boolean } = {},
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (lineage.madeAtLabel) rows.push({ label: "Made", value: lineage.madeAtLabel });
  const settings = canvasSettingsLabel(lineage.settings);
  if (settings) rows.push({ label: "Settings", value: settings });
  const batch = canvasBatchLabel(lineage);
  if (batch) rows.push({ label: "Batch", value: batch });
  rows.push({ label: "Cost", value: canvasCostLabel(lineage) });
  if (options.hasSource) rows.push({ label: "Made from", value: "the card it is joined to" });
  return rows;
}

export type CanvasLineageEdge = { id: string; source: string; target: string };

/** Everything needed to answer "was this card made from another one?". */
export type CanvasNodeSourceFacts = {
  /**
   * `CanvasNode.madeFromNodeId` — the card this one's PAID JOB was conditioned on, and nothing
   * else. One fact, one column (#603 T4).
   *
   * It replaced `sourceNodeId`, which carried three meanings at once — a real derivation, a
   * batch's layout anchor, and an invented sibling parentage the placement path used to enforce
   * — so every reader had to guess which one it was looking at, and the guess needed a second
   * server field (`lineage.madeFromSource`) to be worth anything. Null means no derivation, or
   * a derivation nobody can prove; both draw nothing, which is the honest answer to each.
   */
  madeFromNodeId?: string | null;
};

/** A board card, as far as its parentage is concerned. */
export type CanvasLineageNode = CanvasNodeSourceFacts & { id: string };

/** Was this card made FROM another card? One recorded fact answers it. */
export function canvasNodeHasSource(node: CanvasNodeSourceFacts): boolean {
  return !!node.madeFromNodeId;
}

/**
 * One line per "this card came from that card" link, for every pair still on the board.
 *
 * A video made from an image, and an image evolved from an image, both record the card they
 * came from — but nothing drew it, so the trail was invisible (#547 B4). Self-links and links to
 * cards that are filtered out or deleted are dropped. Same-batch siblings can no longer appear
 * here at all: standing next to something now lives in its own column.
 */
export function buildCanvasLineageEdges(
  nodes: ReadonlyArray<CanvasLineageNode>,
): CanvasLineageEdge[] {
  const present = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges: CanvasLineageEdge[] = [];
  for (const node of nodes) {
    const source = node.madeFromNodeId;
    if (!source || source === node.id || !present.has(source)) continue;
    const id = `lineage-${source}-${node.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, source, target: node.id });
  }
  return edges;
}
