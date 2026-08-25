import "server-only";

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { listRoutines } from "@/lib/customer-workflow-gateway";
import { R22RoutinesView, type R22RoutineRow } from "./R22RoutinesView";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function R22RoutinesEntry({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    const requestedState = first(params.state);
    const fixtureState = requestedState === "loading" || requestedState === "empty" || requestedState === "error" || requestedState === "permission" || requestedState === "unknown" ? requestedState : "ready";
    const requestedOutcome = first(params.outcome);
    const fixtureOutcome = requestedOutcome === "error" || requestedOutcome === "conflict" || requestedOutcome === "unknown" ? requestedOutcome : "success";
    return <R22RoutinesView routines={[]} fixture fixtureState={fixtureState} fixtureOutcome={fixtureOutcome} />;
  }

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const result = await listRoutines({ limit: 50 }).catch(() => null);
  if (!result) return <R22RoutinesView routines={[]} readError="Unexpected read failure" />;
  if (!result.ok) return <R22RoutinesView routines={[]} readError={result.error} />;

  const rows: R22RoutineRow[] = result.resource.items.map((row) => ({
    id: row.id,
    name: row.routineKey,
    cadence: null,
    postsPerWeek: null,
    topic: row.workflowDefinition.name,
    channel: row.scopeSummary.channelCount ? `${row.scopeSummary.channelCount} authorised channel${row.scopeSummary.channelCount === 1 ? "" : "s"}` : null,
    creditsUsed: null,
    creditsCap: row.maxCreditsPerMonth,
    creditPeriod: "monthly",
    status: row.status === "active" && !row.killSwitchEngaged && row.authorization.authorized ? "active" : row.status === "paused" || row.killSwitchEngaged ? "paused" : "draft",
    autoPublish: null,
    warning: row.authorization.authorized ? null : "This routine is not authorised, so Otto cannot run it.",
    policy: null,
    slots: [],
  }));
  return <R22RoutinesView routines={rows} />;
}
