import "server-only";
/**
 * canvas-lineage-data — the owner-scoped read behind a canvas card's traceability record
 * (#547 B4). One place, used by BOTH canvas readers (`listCanvasNodes` and the Otto canvas
 * bridge), so the two can never tell a merchant different stories about the same card.
 *
 * MONEY SAFETY: read-only. It never reserves, settles, refunds, grants, or adjusts anything;
 * it reads what the ledger already recorded and converts it to displayed credits at the view
 * seam. Nothing here can create or charge a job.
 *
 * TENANCY: every query is filtered by the caller's authenticated ownerId (plus projectId);
 * a caller can only ever read the lineage of their own workspace's cards.
 *
 * ENGINE SECRECY: the returned record carries seconds / resolution / aspect / batch position
 * and the credits charged — never the model or provider that produced the asset.
 */

import { prisma } from "@fikirtive/db";
import { displayCredits } from "@fikirtive/core";
import { canvasVideoSettings, type CanvasNodeLineage } from "./canvas-lineage";
import { mergeSettings } from "./owner-settings";
import { formatDayLabel, formatTime, partsInTz } from "./schedule-view";

/** Just enough of a canvas row to look its lineage up. */
export type LineageLookupNode = {
  id: string;
  generationId: string | null;
  genJobId: string | null;
};

const EMPTY_SETTINGS = { durationSeconds: null, resolution: null, aspectRatio: null } as const;

export const UNKNOWN_CANVAS_LINEAGE: CanvasNodeLineage = {
  madeAtLabel: null,
  settings: EMPTY_SETTINGS,
  costCredits: null,
  batchSize: 1,
  batchPosition: null,
};

/**
 * Net credits a paid job actually cost, folded from its ledger rows.
 *
 * A job writes RESERVE (a hold) then SETTLE (or REFUND). Summing the signed balance deltas of
 * every row for that job gives the net charge regardless of which half we happen to see, so a
 * refunded failure reads as 0 rather than as a charge. Exported for its unit test.
 */
export function netChargedInternalCredits(
  rows: ReadonlyArray<{ balanceDelta: number }>,
): number {
  return rows.reduce((total, row) => total - row.balanceDelta, 0);
}

/**
 * Lineage for every supplied card, keyed by card id.
 *
 * Three extra owner-scoped reads for the whole board (jobs, generations, ledger rows) — not
 * one per card.
 */
export async function loadCanvasNodeLineages(
  ownerId: string,
  projectId: string,
  nodes: readonly LineageLookupNode[],
  timezone: string,
): Promise<Record<string, CanvasNodeLineage>> {
  const jobIds = [...new Set(nodes.map((node) => node.genJobId).filter((id): id is string => !!id))];
  const generationIds = [...new Set(nodes.map((node) => node.generationId).filter((id): id is string => !!id))];
  if (!jobIds.length && !generationIds.length) return {};

  const [jobs, generations, ledgerRows] = await Promise.all([
    jobIds.length
      ? prisma.genJob.findMany({
        where: { id: { in: jobIds }, ownerId, projectId },
        select: { id: true, generationIds: true, videoOptions: true, createdAt: true, finishedAt: true },
      })
      : Promise.resolve([]),
    generationIds.length
      ? prisma.generation.findMany({
        where: { id: { in: generationIds }, ownerId, projectId, deletedAt: null },
        select: { id: true, createdAt: true, source: true },
      })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.creditLedger.findMany({
        where: { orgId: ownerId, refId: { in: jobIds } },
        select: { refId: true, balanceDelta: true },
      })
      : Promise.resolve([]),
  ]);

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const madeAtByGeneration = new Map(generations.map((generation) => [generation.id, generation.createdAt]));
  // An image the merchant dropped onto the board was never generated, so it cost nothing —
  // saying "cost not recorded" there would look like a missing record instead of a free card.
  const uploadedGenerations = new Set(
    generations.filter((generation) => generation.source === "UPLOAD").map((generation) => generation.id),
  );
  const ledgerByJob = new Map<string, { balanceDelta: number }[]>();
  for (const row of ledgerRows) {
    if (!row.refId) continue;
    const group = ledgerByJob.get(row.refId) ?? [];
    group.push({ balanceDelta: row.balanceDelta });
    ledgerByJob.set(row.refId, group);
  }

  const label = (at: Date | null | undefined): string | null => {
    if (!at) return null;
    const parts = partsInTz(at, timezone);
    return `${formatDayLabel(parts)}, ${formatTime(parts)}`;
  };

  const out: Record<string, CanvasNodeLineage> = {};
  for (const node of nodes) {
    const job = node.genJobId ? jobById.get(node.genJobId) : undefined;
    if (!job && !node.generationId) continue;
    const rows = node.genJobId ? ledgerByJob.get(node.genJobId) : undefined;
    const batchSize = Math.max(1, job?.generationIds.length ?? 1);
    const index = node.generationId && job ? job.generationIds.indexOf(node.generationId) : -1;
    out[node.id] = {
      madeAtLabel: label(
        (node.generationId ? madeAtByGeneration.get(node.generationId) : null)
          ?? job?.finishedAt
          ?? job?.createdAt,
      ),
      settings: job ? canvasVideoSettings(job.videoOptions) : EMPTY_SETTINGS,
      costCredits: rows
        ? displayCredits(netChargedInternalCredits(rows))
        : (!node.genJobId && node.generationId && uploadedGenerations.has(node.generationId) ? 0 : null),
      batchSize,
      batchPosition: index >= 0 ? index + 1 : null,
    };
  }
  return out;
}

/**
 * Attach every card's lineage to a already-owner-scoped board read.
 *
 * The two canvas readers (`listCanvasNodes` and the Otto canvas bridge) both end here, so a
 * merchant is told the same thing about the same card whichever one loaded the board. Times
 * are formatted in the workspace's own timezone, server-side, so the label is byte-identical
 * on server and client.
 */
export async function withCanvasLineage<T extends LineageLookupNode>(
  ownerId: string,
  projectId: string,
  nodes: T[],
): Promise<Array<T & { lineage: CanvasNodeLineage | null }>> {
  let lineages: Record<string, CanvasNodeLineage> = {};
  try {
    const organization = await prisma.organization.findFirst({
      where: { id: ownerId, deletedAt: null },
      select: { settings: true },
    });
    const timezone = mergeSettings(organization?.settings).timezone;
    lineages = await loadCanvasNodeLineages(ownerId, projectId, nodes, timezone);
  } catch (error) {
    // The board is the merchant's paid work; a traceability lookup is not. A failure here
    // costs an Info panel, so it must never blank the canvas — degrade to "no record" and
    // leave a server-side trace instead of throwing the whole read away.
    console.warn("[canvas] lineage lookup failed; cards render without their record:", error);
    lineages = {};
  }
  return nodes.map((node) => ({ ...node, lineage: lineages[node.id] ?? null }));
}
