import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("workflow UI read wiring", () => {
  it("preloads and refreshes every Stage 3 read surface", () => {
    const route = source("../../app/crm/workflows/[id]/page.tsx");
    const detail = source("../../components/crm/workflows/workflow-detail-page.tsx");

    for (const read of [
      "listRoutines",
      "listRoutineRuns",
      "getContactJourneyStates",
      "listBusinessHoursPolicies",
    ]) {
      expect(route).toContain(read);
      expect(detail).toContain(read);
    }
    expect(route).toContain("initialRoutines={routines}");
    expect(route).toContain("initialRuns={runs}");
    expect(route).toContain("initialJourneys={journeys}");
    expect(route).toContain("initialPolicies={policies}");
    expect(detail).toContain("Promise.allSettled");
    expect(detail).not.toContain("activeRoutines={null}");
    expect(detail).not.toContain("data={null}");
  });

  it("exhausts Routine pages for detail and archive and fails archive closed", () => {
    const route = source("../../app/crm/workflows/[id]/page.tsx");
    const archive = source("../../components/crm/workflows/archive-workflow-dialog.tsx");

    expect(route).toContain("do {");
    expect(route).toContain("page.resource.nextCursor");
    expect(route).toContain("limit: 200");
    expect(archive).toContain('status: "active"');
    expect(archive).toContain("page.resource.nextCursor");
    expect(archive).toContain("} while (cursor)");
    expect(archive).toContain("if (active === null) return");
    expect(archive).toContain("active === null ||");
    expect(archive).toContain("Archive blocked");
  });

  it("keeps every persisted Routine kill reachable and reads exact authorization details", () => {
    const routines = source("../../components/crm/workflows/routine-authorization-panel.tsx");

    expect(routines).toContain("persistedRoutines.map");
    expect(routines).toContain("killPersistedRoutine(routine)");
    expect(routines).toContain("getRoutine({ routineId })");
    expect(routines).toContain("View authorization");
    expect(routines).toContain("routineDetail.predecessors.length");
    expect(routines).toContain("JSON.stringify(routineDetail, null, 2)");
  });

  it("renders real run, journey, and policy reads while preserving unavailable seams", () => {
    const monitoring = source("../../components/crm/workflows/workflow-monitoring.tsx");
    const recipes = source("../../components/crm/workflows/workflow-recipes-panel.tsx");

    expect(monitoring).toContain("listRoutineRuns");
    expect(monitoring).toContain("getContactJourneyStates");
    expect(monitoring).toContain("No step-by-step send or delivery status is guessed");
    expect(monitoring).not.toContain("dispatchWorkflowStep");
    expect(recipes).toContain("listBusinessHoursPolicies");
    expect(recipes).toContain("getBusinessHoursPolicy");
    expect(recipes).toContain('const WEEKDAYS = ["", "Monday"');
    expect(recipes).toContain("server-owned recipe catalog is not exposed");
    expect(recipes).toContain("strict workflow messaging classification");
  });
});
