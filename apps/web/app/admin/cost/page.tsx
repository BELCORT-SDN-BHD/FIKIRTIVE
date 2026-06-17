import { redirect } from "next/navigation";
import { prisma } from "@artlio/db";
import { FOUNDER_OWNER_ID } from "@artlio/core";
import { requireRole } from "@/lib/auth-guard";
import { CostAdmin, type DayRow, type JobRow } from "@/components/admin/CostAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Cost · Artlio admin" };

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function CostPage() {
  // §② Cost & usage read = finance (or super-admin). requireRole re-asserts the
  // allowlist outer wall + the section→role matrix, and audits a denied read.
  const gate = await requireRole("cost", "read");
  if ("error" in gate) redirect("/login?from=/admin/cost");

  const since = new Date(Date.now() - 30 * DAY_MS);
  // RECORD-ONLY reads: spentUsd is never null-coalesced into a spend decision here.
  const [genJobs, refGenJobs] = await Promise.all([
    prisma.genJob.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, spentUsd: { not: null }, finishedAt: { gte: since } },
      select: { id: true, kind: true, model: true, count: true, status: true, spentUsd: true, finishedAt: true },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.refGenJob.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, spentUsd: { not: null }, finishedAt: { gte: since } },
      select: { id: true, mode: true, model: true, count: true, status: true, spentUsd: true, finishedAt: true },
      orderBy: { finishedAt: "desc" },
    }),
  ]);

  // unify into one job list (source tags the origin)
  const jobs: JobRow[] = [
    ...genJobs.map((j) => ({ id: j.id, source: "gen" as const, label: j.kind === "VIDEO" ? "video" : "image", model: j.model, count: j.count, status: j.status, spentUsd: j.spentUsd ?? 0, finishedAt: (j.finishedAt ?? new Date(0)).toISOString() })),
    ...refGenJobs.map((j) => ({ id: j.id, source: "refgen" as const, label: `ref:${j.mode.toLowerCase()}`, model: j.model, count: j.count, status: j.status, spentUsd: j.spentUsd ?? 0, finishedAt: (j.finishedAt ?? new Date(0)).toISOString() })),
  ].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  // per-day totals (UTC day key)
  const byDay = new Map<string, { day: string; usd: number; jobs: number }>();
  for (const j of jobs) {
    const day = j.finishedAt.slice(0, 10);
    const e = byDay.get(day) ?? { day, usd: 0, jobs: 0 };
    e.usd += j.spentUsd; e.jobs += 1;
    byDay.set(day, e);
  }
  const days: DayRow[] = Array.from(byDay.values()).sort((a, b) => b.day.localeCompare(a.day));

  const totalUsd = jobs.reduce((s, j) => s + j.spentUsd, 0);

  return <CostAdmin days={days} jobs={jobs.slice(0, 100)} totalUsd={totalUsd} jobCount={jobs.length} sinceDays={30} />;
}
