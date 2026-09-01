import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

// W2-13 (#993) — the workflow ROUTE (`app/crm/workflows/[id]/page.tsx`) used to preload
// Stage 3's four reads and paginate Routines to exhaustion before handing them to the detail
// page. The whole CRM section is hidden until Meta verification passes (Founder ruling
// 2026-08-18; restore trigger recorded on issue #359), so every /crm route is a bare
// `redirect(SHELL_ROUTES.home)` now and its loader is gone with it — rebuilding those loaders is part of
// restoring CRM, and this file says so out loud rather than going quiet.
//
// Everything below the route is untouched and still fully pinned here: the detail page, the
// archive dialog, the authorization panel and the monitoring panel are all component-side.
describe("workflow UI read wiring", () => {
  it("the route no longer loads anything — it redirects (CRM hidden, W2-13/#993)", () => {
    const route = source("../../app/crm/workflows/[id]/page.tsx");

    expect(route).toContain("redirect(SHELL_ROUTES.home)");
    expect(route).toContain('@fikirtive/core/navigation');
    for (const read of [
      "listRoutines",
      "listRoutineRuns",
      "getContactJourneyStates",
      "listBusinessHoursPolicies",
    ]) {
      expect(route, `route 还在取 ${read}`).not.toContain(read);
    }
  });

  it("the detail page still refreshes every Stage 3 read surface for itself", () => {
    const detail = source("../../components/crm/workflows/workflow-detail-page.tsx");

    for (const read of [
      "listRoutines",
      "listRoutineRuns",
      "getContactJourneyStates",
      "listBusinessHoursPolicies",
    ]) {
      expect(detail).toContain(read);
    }
    expect(detail).toContain("Promise.allSettled");
    expect(detail).not.toContain("activeRoutines={null}");
    expect(detail).not.toContain("data={null}");
  });

  it("exhausts Routine pages for archive and fails archive closed", () => {
    const archive = source("../../components/crm/workflows/archive-workflow-dialog.tsx");

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

/**
 * #753 — every workflow panel printed the raw refusal code under its sentence
 * ("Error code: CAS_CONFLICT"), and the rule validation list printed the raw validation code
 * beside the path. An internal identifier is not copy: it names nothing the merchant can act on,
 * and #683/#684 already settled that internal strings never reach the customer.
 *
 * These are file-level fences rather than one-block assertions on purpose. Ten separate failure
 * blocks grew the same line; closing the class means no file in this folder may render it again.
 * The code itself is not lost — each block carries it as a data attribute, which support and QA
 * can read in the developer tools and no merchant ever sees.
 */
const WORKFLOW_PANEL_FILES = [
  "../../components/crm/workflows/workflow-list-page.tsx",
  "../../components/crm/workflows/workflow-detail-page.tsx",
  "../../components/crm/workflows/workflow-recipes-panel.tsx",
  "../../components/crm/workflows/archive-workflow-dialog.tsx",
  "../../components/crm/workflows/routine-authorization-panel.tsx",
  "../../components/crm/workflows/workflow-monitoring.tsx",
] as const;

describe("workflow panel failure copy (#753)", () => {
  it("shows no machine error code in any workflow panel", () => {
    for (const file of WORKFLOW_PANEL_FILES) {
      expect(source(file), file).not.toContain("Error code:");
    }
  });

  it("keeps every failure code reachable in the developer view instead", () => {
    const attributes = (file: string) => source(file).match(/data-error-code=/g)?.length ?? 0;

    expect(attributes(WORKFLOW_PANEL_FILES[0])).toBe(2);
    expect(attributes(WORKFLOW_PANEL_FILES[1])).toBe(2);
    expect(attributes(WORKFLOW_PANEL_FILES[2])).toBe(2);
    expect(attributes(WORKFLOW_PANEL_FILES[3])).toBe(1);
    expect(attributes(WORKFLOW_PANEL_FILES[4])).toBe(3);
    expect(source(WORKFLOW_PANEL_FILES[1])).toContain("data-issue-code={issue.code}");
  });
});
