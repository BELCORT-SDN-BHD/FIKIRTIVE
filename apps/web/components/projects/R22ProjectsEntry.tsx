import "server-only";

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getProjects } from "@/lib/data";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
import { R22ProjectsView, type R22ProjectRow } from "./R22ProjectsView";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function R22ProjectsEntry({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(sp.fixture) === "r22";
  if (fixture) {
    const requestedState = first(sp.state);
    const state = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "empty" || requestedState === "unknown" ? requestedState : "ready";
    const requestedOutcome = first(sp.outcome);
    const outcome = requestedOutcome === "error" || requestedOutcome === "permission" || requestedOutcome === "unknown" ? requestedOutcome : "success";
    const rows: R22ProjectRow[] = [{ id: "fixture-raya", name: "Raya launch", ownerLabel: "You", modifiedLabel: "Just now", visibility: "Private", briefLabel: "Create a Raya launch set for Instagram Stories and feed." }];
    return <R22ProjectsView projects={state === "empty" ? [] : rows} fixture fixtureState={state} fixtureCreateOutcome={outcome} />;
  }

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const projects = await getProjects(owner.ownerId);
  return (
    <R22ProjectsView
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        ownerLabel: "You",
        modifiedLabel: MY_DATE_FORMAT.format(project.updatedAt),
        visibility: "Private",
        briefLabel: project.coworkBrief ? "Brief ready" : "No brief yet",
      }))}
    />
  );
}
