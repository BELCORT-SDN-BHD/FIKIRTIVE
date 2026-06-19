import { redirect } from "next/navigation";
import { prisma } from "@artlio/db";
import { requireRole } from "@/lib/auth-guard";
import { SystemAdmin, type StatusCounts, type FailedRow } from "@/components/admin/SystemAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "System · Artlio admin" };

const DAY_MS = 24 * 60 * 60 * 1000;

// the queue statuses each job table can sit in (mirrors the schema enums)
const GEN_STATUSES = ["QUEUED", "GENERATING", "DONE", "FAILED"] as const;
const RENDER_STATUSES = ["QUEUED", "RENDERING", "DONE", "FAILED"] as const;

function countsByStatus(rows: { status: string; _count: { _all: number } }[], statuses: readonly string[]): StatusCounts {
  const out: StatusCounts = {};
  for (const s of statuses) out[s] = 0;
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

export default async function SystemPage() {
  // §⑤ System & queue read = viewer+ (per the section→role matrix). requireRole
  // re-asserts the allowlist outer wall + the matrix, and audits a denied read.
  const gate = await requireRole("system", "read");
  if ("error" in gate) redirect("/login?from=/admin/system");

  // async server component, rendered once per request — request-time Date.now() is
  // the intended behavior, not a re-render purity hazard.
  // eslint-disable-next-line react-hooks/purity
  const todayStart = new Date(Date.now() - DAY_MS);

  // READ-ONLY: summarize the app job tables (no pg-boss internal-schema coupling).
  // groupBy status per table = the "is anything stuck" view; recent FAILED = what's broken.
  const [genGroups, refGenGroups, renderGroups, genFailed, refGenFailed, renderFailed, genSpend, refGenSpend] = await Promise.all([
    // P3: platform-wide (staff-gated by requireRole) — aggregate across ALL orgs, not just founder.
    prisma.genJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.refGenJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.renderJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.genJob.findMany({
      where: { status: "FAILED" },
      orderBy: { finishedAt: "desc" }, take: 15,
      select: { id: true, kind: true, model: true, error: true, finishedAt: true, updatedAt: true },
    }),
    prisma.refGenJob.findMany({
      where: { status: "FAILED" },
      orderBy: { finishedAt: "desc" }, take: 15,
      select: { id: true, mode: true, model: true, error: true, finishedAt: true, updatedAt: true },
    }),
    prisma.renderJob.findMany({
      where: { status: "FAILED" },
      orderBy: { finishedAt: "desc" }, take: 15,
      select: { id: true, error: true, finishedAt: true, updatedAt: true },
    }),
    // RECORD-ONLY: today's spend is the frozen spentUsd ledger summed — never a spend decision.
    prisma.genJob.aggregate({ where: { spentUsd: { not: null }, finishedAt: { gte: todayStart } }, _sum: { spentUsd: true } }),
    prisma.refGenJob.aggregate({ where: { spentUsd: { not: null }, finishedAt: { gte: todayStart } }, _sum: { spentUsd: true } }),
  ]);

  const genCounts = countsByStatus(genGroups, GEN_STATUSES);
  const refGenCounts = countsByStatus(refGenGroups, GEN_STATUSES);
  const renderCounts = countsByStatus(renderGroups, RENDER_STATUSES);

  // merge + sort the recent failures across the three tables (most-recent first)
  const failed: FailedRow[] = [
    ...genFailed.map((j) => ({ id: j.id, table: "gen" as const, kind: j.kind === "VIDEO" ? "video" : "image", model: j.model, error: j.error, finishedAt: (j.finishedAt ?? j.updatedAt).toISOString() })),
    ...refGenFailed.map((j) => ({ id: j.id, table: "refgen" as const, kind: `ref:${j.mode.toLowerCase()}`, model: j.model, error: j.error, finishedAt: (j.finishedAt ?? j.updatedAt).toISOString() })),
    ...renderFailed.map((j) => ({ id: j.id, table: "render" as const, kind: "render", model: "ffmpeg", error: j.error, finishedAt: (j.finishedAt ?? j.updatedAt).toISOString() })),
  ].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 25);

  // "is anything in flight" — QUEUED + active (GENERATING/RENDERING) across the tables
  const active =
    (genCounts.QUEUED ?? 0) + (genCounts.GENERATING ?? 0) +
    (refGenCounts.QUEUED ?? 0) + (refGenCounts.GENERATING ?? 0) +
    (renderCounts.QUEUED ?? 0) + (renderCounts.RENDERING ?? 0);

  const spendTodayUsd = (genSpend._sum.spentUsd ?? 0) + (refGenSpend._sum.spentUsd ?? 0);

  return (
    <SystemAdmin
      genCounts={genCounts}
      refGenCounts={refGenCounts}
      renderCounts={renderCounts}
      failed={failed}
      activeCount={active}
      spendTodayUsd={spendTodayUsd}
    />
  );
}
