import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARITY_MANIFEST, PARITY_READ_SURFACES, type ParityManifestEntry } from "./parity-manifest.js";
import { allSkills } from "./registry.js";

// The 9th seam's core invariant (harmony-02 §二.2): every skill a manifest entry points at must
// really exist in the registry; every exemption uses one of the four closed classes; every TODO
// carries a note. This is the load-bearing subset of the future check-parity.sh — a unit test
// until that lands. `as const` narrows the literal, so widen back to ParityManifestEntry to see all branches.
const entries = Object.entries(PARITY_MANIFEST) as [string, ParityManifestEntry][];
const HERE = path.dirname(fileURLToPath(import.meta.url)); // packages/otto/src
const REPO_ROOT = path.resolve(HERE, "../../..");

describe("parity manifest", () => {
  const skillNames = new Set(allSkills.map((s) => s.name));

  it("every paired action references a real registered skill", () => {
    for (const [action, entry] of entries) {
      if ("skill" in entry) {
        expect(skillNames.has(entry.skill), `${action} → unknown skill "${entry.skill}"`).toBe(true);
      }
    }
  });

  it("registers the complete CRM Segment read and act action layer", () => {
    expect(PARITY_MANIFEST["segment-actions.listSegments"]).toMatchObject({ skill: "readSegments" });
    expect(PARITY_MANIFEST["segment-actions.getSegment"]).toMatchObject({ skill: "readSegments" });
    expect(PARITY_MANIFEST["segment-actions.previewSegment"]).toMatchObject({ skill: "readSegments" });
    expect(PARITY_MANIFEST["segment-actions.buildSegment"]).toMatchObject({ skill: "buildSegment" });
  });

  it("registers the complete zero-cost Campaign read and act action layer without new debt", () => {
    expect(PARITY_MANIFEST["campaign-view-data.listCampaigns"]).toMatchObject({ skill: "readCampaigns" });
    expect(PARITY_MANIFEST["campaign-view-data.getCampaign"]).toMatchObject({ skill: "readCampaigns" });
    expect(PARITY_MANIFEST["trend-actions.listTrendSnapshots"]).toMatchObject({ skill: "readCampaigns" });
    expect(PARITY_MANIFEST["campaign-actions.proposeCampaign"]).toMatchObject({ skill: "planCampaign" });
    expect(PARITY_MANIFEST["campaign-actions.proposeCampaignEntry"]).toMatchObject({ skill: "planCampaign" });
    expect(PARITY_MANIFEST["campaign-actions.updateCampaignEntry"]).toMatchObject({ skill: "planCampaign" });
    expect(PARITY_MANIFEST["campaign-actions.removeCampaignEntry"]).toMatchObject({ skill: "planCampaign" });
    expect(PARITY_MANIFEST["campaign-actions.approveCampaignEntry"]).toMatchObject({ skill: "planCampaign" });
    expect(PARITY_MANIFEST["campaign-actions.setCampaignGrouping"]).toMatchObject({ skill: "planCampaign" });
    expect(PARITY_MANIFEST["trend-actions.saveTrendSnapshot"]).toMatchObject({ skill: "planCampaign" });
  });

  it("registers all six Workflow lifecycle reads as real readWorkflows parity without new debt", () => {
    for (const action of [
      "listRoutines",
      "getRoutine",
      "listRoutineRuns",
      "getContactJourneyStates",
      "listBusinessHoursPolicies",
      "getBusinessHoursPolicy",
    ] as const) {
      expect(PARITY_MANIFEST[`customer-workflow-ui-actions.${action}`]).toMatchObject({
        skill: "readWorkflows",
      });
    }
    const todoCount = entries.filter(([, entry]) => "todoSkill" in entry).length;
    const baseline = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "scripts/parity-debt-baseline.json"), "utf8"),
    ) as { maxTodoSkill: number };
    expect(todoCount).toBe(65);
    expect(baseline.maxTodoSkill).toBe(65);
  });

  it("every exemption uses one of the four closed classes with a non-empty reason", () => {
    const CLASSES = new Set(["ADMIN", "VISUAL", "MONEY_IN", "ACCOUNT_SECURITY"]);
    for (const [action, entry] of entries) {
      if ("exempt" in entry) {
        expect(CLASSES.has(entry.exempt), `${action} → invalid exempt class "${entry.exempt}"`).toBe(true);
        expect(entry.reason.trim().length, `${action} → exemption needs a reason`).toBeGreaterThan(0);
      }
    }
  });

  it("every TODO_SKILL debt entry carries a non-empty note", () => {
    for (const [action, entry] of entries) {
      if ("todoSkill" in entry) {
        expect(entry.todoSkill, `${action} → TODO_SKILL flag must be true`).toBe(true);
        expect(entry.reason.trim().length, `${action} → TODO_SKILL needs a note`).toBeGreaterThan(0);
      }
    }
  });

  it("Otto page data imports are registered read surfaces", () => {
    const page = fs.readFileSync(path.join(REPO_ROOT, "apps/web/app/otto/page.tsx"), "utf8");
    const match = page.match(/import\s+\{([^}]+)\}\s+from\s+"@\/lib\/data";/m);
    expect(match, "app/otto/page.tsx should keep lib/data imports in one import declaration").not.toBeNull();

    const importedReads = (match?.[1] ?? "")
      .split(",")
      .map((raw) => raw.trim().replace(/\s+as\s+\w+$/, ""))
      .filter(Boolean);
    const registered = new Set<string>(PARITY_READ_SURFACES.map((surface) => surface.key));

    for (const read of importedReads) {
      expect(
        registered.has(`data.${read}`),
        `app/otto/page.tsx imports ${read} from lib/data, but PARITY_READ_SURFACES has no data.${read} entry.`,
      ).toBe(true);
    }
  });
});
