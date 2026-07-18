import type { RunContext } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import type { OttoContext } from "../context.js";
import { buildSegmentSkill, executeBuildSegment } from "./build-segment.js";
import {
  crmSegmentRuleGroup,
  executeReadSegments,
  readSegmentsSkill,
} from "./read-segments.js";

const rules = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "contactable" as const }],
};

function runContext(segments?: OttoContext["segments"]): Pick<RunContext<OttoContext>, "context"> {
  return { context: { segments } as OttoContext };
}

function ports() {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, evaluatedAt: "2026-07-18T00:00:00.000Z", segments: [] }),
    get: vi.fn().mockResolvedValue({ error: "Segment not found." }),
    preview: vi.fn().mockResolvedValue({ ok: true, matchedCount: 0 }),
    build: vi.fn().mockResolvedValue({
      ok: true,
      operation: "create",
      idempotent: false,
      segment: { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "Audience", phrase: "", rules, createdAt: "" },
    }),
  } as unknown as NonNullable<OttoContext["segments"]>;
}

describe("CRM Segment skills", () => {
  it("declares the fail-closed free/internal read and write classifications", () => {
    expect(readSegmentsSkill).toMatchObject({
      name: "readSegments",
      cost: "free",
      effect: "read",
      reach: "internal",
      needsApproval: false,
    });
    expect(buildSegmentSkill).toMatchObject({
      name: "buildSegment",
      cost: "free",
      effect: "write",
      reach: "internal",
      needsApproval: false,
    });
  });

  it("accepts only a structured one-level rule object, never free-form prose", () => {
    expect(crmSegmentRuleGroup.safeParse(rules).success).toBe(true);
    expect(crmSegmentRuleGroup.safeParse("contactable customers").success).toBe(false);
    expect(
      crmSegmentRuleGroup.safeParse({
        match: "all",
        rules: [{ kind: "contactability", value: "contactable", prose: "guess this" }],
      }).success,
    ).toBe(false);
  });

  it("routes list, exact get, and structured preview through the injected port", async () => {
    const segmentPorts = ports();

    await executeReadSegments({ operation: "list" }, runContext(segmentPorts));
    await executeReadSegments(
      { operation: "get", segmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      runContext(segmentPorts),
    );
    await executeReadSegments({ operation: "preview", rules }, runContext(segmentPorts));

    expect(segmentPorts.list).toHaveBeenCalledTimes(1);
    expect(segmentPorts.get).toHaveBeenCalledWith("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(segmentPorts.preview).toHaveBeenCalledWith(rules);
  });

  it("routes create/update through one port and refuses missing or model-chosen ids", async () => {
    const segmentPorts = ports();
    await executeBuildSegment(
      { operation: "create", name: "Audience", rules },
      runContext(segmentPorts),
    );
    await executeBuildSegment(
      {
        operation: "update",
        segmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        name: "Audience",
        rules,
      },
      runContext(segmentPorts),
    );

    expect(segmentPorts.build).toHaveBeenNthCalledWith(1, {
      operation: "create",
      segmentId: undefined,
      name: "Audience",
      rules,
    });
    expect(segmentPorts.build).toHaveBeenNthCalledWith(2, {
      operation: "update",
      segmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      name: "Audience",
      rules,
    });
    await expect(
      executeBuildSegment(
        { operation: "update", name: "Audience", rules },
        runContext(segmentPorts),
      ),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("segmentId") });
    await expect(
      executeBuildSegment(
        {
          operation: "create",
          segmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          name: "Audience",
          rules,
        },
        runContext(segmentPorts),
      ),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("server-issued") });
    expect(segmentPorts.build).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the authenticated web port is absent", async () => {
    await expect(executeReadSegments({ operation: "list" }, runContext())).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("aren't available"),
    });
    await expect(
      executeBuildSegment({ operation: "create", name: "Audience", rules }, runContext()),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("aren't available") });
  });
});
