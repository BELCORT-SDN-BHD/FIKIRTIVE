import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";
import {
  orchestrateBatch,
  quoteCell,
  MAX_BATCH_CELLS,
  type BatchCell,
  type GenCell,
  type StartGenPort,
  type OrchestrateDeps,
} from "../factory-batch";
import { factoryAttemptKey, normalizeFactoryMaterial } from "../batch-idempotency";

type JobRow = {
  id: string; ownerId: string; projectId?: string; batchId: string | null; status: string; idempotencyKey?: string;
  prompt?: string; model?: string; kind?: string; count?: number;
  entityIds?: string[]; variantSel?: Record<string, string> | null;
  sourceGenerationId?: string | null; tailGenerationId?: string | null;
  referenceVideoGenerationId?: string | null; shotId?: string | null;
  videoOptions?: Record<string, unknown> | null;
  imageOptions?: Record<string, unknown> | null;
};

// A tiny in-memory prisma double for the two tables orchestrateBatch touches. It moves
// NO money — the whole point is that orchestration only writes grouping metadata.
function fakePrisma() {
  const batches = new Map<string, { id: string; ownerId: string }>();
  const jobs = new Map<string, JobRow>();
  const db: OrchestrateDeps["prisma"] = {
    generationBatch: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; ownerId: string } }) => {
        const b = batches.get(where.id);
        return b && b.ownerId === where.ownerId ? { id: b.id } : null;
      }),
      create: vi.fn(async ({ data }: { data: { id: string; ownerId: string } }) => {
        if (batches.has(data.id)) {
          const e = Object.assign(new Error("dup"), { code: "P2002" });
          throw e;
        }
        batches.set(data.id, { id: data.id, ownerId: data.ownerId });
        return { id: data.id };
      }),
    },
    genJob: {
      findFirst: vi.fn(async ({ where }: { where: { ownerId: string; projectId?: string; idempotencyKey?: string } }) => {
        const match = [...jobs.values()].find(
          (j) => j.ownerId === where.ownerId && where.idempotencyKey != null && j.idempotencyKey === where.idempotencyKey,
        );
        return match
          ? {
              id: match.id, status: match.status, prompt: match.prompt ?? "", model: match.model ?? "seedream",
              kind: match.kind ?? "IMAGE", count: match.count ?? 1,
              entityIds: match.entityIds ?? [], variantSel: match.variantSel ?? null,
              sourceGenerationId: match.sourceGenerationId ?? null, tailGenerationId: match.tailGenerationId ?? null,
              referenceVideoGenerationId: match.referenceVideoGenerationId ?? null, shotId: match.shotId ?? null,
              videoOptions: match.videoOptions ?? null,
            }
          : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; ownerId: string }; data: { batchId: string } }) => {
        const j = jobs.get(where.id);
        if (j && j.ownerId === where.ownerId) j.batchId = data.batchId;
        return { count: j ? 1 : 0 };
      }),
      findMany: vi.fn(async ({ where, select }: {
        where: {
          ownerId: string;
          projectId?: string;
          batchId?: string;
          idempotencyKey?: { startsWith: string };
        };
        select?: Record<string, boolean>;
      }) => {
        const rows = [...jobs.values()].filter((j) =>
          j.ownerId === where.ownerId &&
          (where.projectId == null || j.projectId === where.projectId) &&
          (where.batchId == null || j.batchId === where.batchId) &&
          (where.idempotencyKey == null || j.idempotencyKey?.startsWith(where.idempotencyKey.startsWith)),
        );
        if (where.batchId != null) return rows.map((j) => ({ status: j.status }));
        const stored = (j: JobRow): Record<string, unknown> => ({
          id: j.id,
          status: j.status,
          idempotencyKey: j.idempotencyKey ?? null,
          prompt: j.prompt ?? "",
          model: j.model ?? "seedream",
          kind: j.kind ?? "IMAGE",
          count: j.count ?? 1,
          entityIds: j.entityIds ?? [],
          variantSel: j.variantSel ?? null,
          sourceGenerationId: j.sourceGenerationId ?? null,
          tailGenerationId: j.tailGenerationId ?? null,
          referenceVideoGenerationId: j.referenceVideoGenerationId ?? null,
          shotId: j.shotId ?? null,
          videoOptions: j.videoOptions ?? null,
          imageOptions: j.imageOptions ?? null,
        });
        // 忠实模拟 Prisma:**只回 select 点名的列**。一个没被点名的列在结果对象里根本不存在
        // —— 这正是「投影漏列」这类缺陷在真库上的形状,替身不许比真库宽容。
        return rows.map((j) =>
          Object.fromEntries(Object.entries(stored(j)).filter(([column]) => select?.[column])));
      }),
    },
  } as unknown as OrchestrateDeps["prisma"];
  return { db, jobs };
}

// A startGen spy that records every request and mints a job row in the fake prisma so
// the batchId tag has something to write to.
type StartGenOutcome =
  | { id: string; disposition: "fresh" | "reused" }
  | { error: string; disposition?: "conflict" };

function spyStartGen(
  jobs: Map<string, JobRow>,
  ownerId: string,
  override?: (i: number, req: Record<string, unknown>) => StartGenOutcome | null,
) {
  let n = 0;
  const calls: Record<string, unknown>[] = [];
  const fn: StartGenPort = vi.fn(async (req: Record<string, unknown>) => {
    const idx = n++;
    calls.push(req);
    const over = override?.(idx, req) ?? null;
    if (over) return over;
    const id = `job-${idx}`;
    const kind = req.kind === "video" ? "video" : "image";
    const material = normalizeFactoryMaterial({
      prompt: req.prompt as string,
      model: req.model as string,
      kind,
      count: req.count as number,
      entityIds: req.entityIds as string[],
      variantSel: req.variantSel as Record<string, string> | undefined,
      sourceGenerationId: req.sourceGenerationId as string | null | undefined,
      tailGenerationId: req.tailGenerationId as string | null | undefined,
      referenceVideoGenerationId: req.referenceVideoGenerationId as string | null | undefined,
      shotId: req.shotId as string | null | undefined,
      durationSeconds: req.durationSeconds as number | null | undefined,
      resolution: req.resolution as string | null | undefined,
      aspectRatio: req.aspectRatio as string | null | undefined,
      fps: req.fps as number | null | undefined,
      audio: req.audio as boolean | null | undefined,
    });
    jobs.set(id, {
      id,
      ownerId,
      projectId: req.projectId as string,
      batchId: null,
      status: "QUEUED",
      idempotencyKey: req.idempotencyKey as string,
      ...material,
    });
    return { id, disposition: "fresh" as const };
  });
  return { fn, calls };
}

const OWNER = "org_test";
const PROJECT = "prj_test";
const ATTEMPT_A = "attempt-a";
const ATTEMPT_B = "attempt-b";

function genCell(prompt: string, extra: Partial<Omit<GenCell, "type" | "prompt">> = {}): BatchCell {
  return { type: "gen", prompt, ...extra };
}

describe("quoteCell — same authority as startGen's reserve (pricedGenCredits)", () => {
  it("prices an image cell at count × INTERNAL_PER_DISPLAY and a text cell at 0", () => {
    expect(quoteCell(genCell("a"))).toBe(1 * INTERNAL_PER_DISPLAY);
    expect(quoteCell(genCell("a", { count: 3 }))).toBe(3 * INTERNAL_PER_DISPLAY);
    expect(quoteCell({ type: "text", text: "hook" })).toBe(0);
  });
});

describe("orchestrateBatch — dispatch behaviour", () => {
  it("derives 79-char logical-cell + attempt keys and sums the quote", async () => {
    const { db, jobs } = fakePrisma();
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "B1", attemptId: ATTEMPT_A, cells: [genCell("a"), genCell("b"), genCell("c")] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.dispatched).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.totalCredits).toBe(3 * INTERNAL_PER_DISPLAY);
    expect(calls.map((c) => c.idempotencyKey)).toEqual([
      factoryAttemptKey("B1", 0, ATTEMPT_A).key,
      factoryAttemptKey("B1", 1, ATTEMPT_A).key,
      factoryAttemptKey("B1", 2, ATTEMPT_A).key,
    ]);
    expect(calls.every((c) => (c.idempotencyKey as string).length === 79)).toBe(true);
    expect(calls.every((c) => c.projectId === PROJECT)).toBe(true);
    expect(res.cells.every((c) => c.status === "queued" && c.credits === INTERNAL_PER_DISPLAY)).toBe(true);
  });

  it("text cells are $0 and never enter startGen", async () => {
    const { db, jobs } = fakePrisma();
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const cells: BatchCell[] = [{ type: "text", text: "Big Sale" }, genCell("product on white")];
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "B2", attemptId: ATTEMPT_A, cells });
    if ("error" in res) throw new Error(res.error);
    expect(calls).toHaveLength(1);
    expect(res.cells[0]).toMatchObject({ type: "text", status: "text", credits: 0 });
    expect(res.cells[1]).toMatchObject({ type: "gen", status: "queued", credits: INTERNAL_PER_DISPLAY });
    expect(res.totalCredits).toBe(INTERNAL_PER_DISPLAY);
  });

  it("a replay with the SAME batchId reproduces the SAME per-cell keys (dedup anchor)", async () => {
    const { db, jobs } = fakePrisma();
    const a = spyStartGen(jobs, OWNER);
    await orchestrateBatch({ startGen: a.fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "SAME", attemptId: ATTEMPT_A, cells: [genCell("a"), genCell("b")] });
    const b = spyStartGen(jobs, OWNER);
    await orchestrateBatch({ startGen: b.fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "SAME", attemptId: ATTEMPT_A, cells: [genCell("a"), genCell("b")] });
    expect(a.calls.map((c) => c.idempotencyKey)).toEqual(b.calls.map((c) => c.idempotencyKey));
    expect(b.calls.map((c) => c.idempotencyKey)).toEqual([
      factoryAttemptKey("SAME", 0, ATTEMPT_A).key,
      factoryAttemptKey("SAME", 1, ATTEMPT_A).key,
    ]);
  });

  it("partial dispatch failure marks only the failed cells — no batch-level rollback", async () => {
    const { db, jobs } = fakePrisma();
    const { fn } = spyStartGen(jobs, OWNER, (i) => (i === 1 ? { error: "no" } : null));
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "B3", attemptId: ATTEMPT_A, cells: [genCell("a"), genCell("b"), genCell("c")] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.dispatched).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.cells[1]).toMatchObject({ status: "error" });
    expect(res.cells[0].status).toBe("queued");
    expect(res.cells[2].status).toBe("queued");
  });

  it("rejects an empty batch and one over the cell cap", async () => {
    const { db, jobs } = fakePrisma();
    const { fn } = spyStartGen(jobs, OWNER);
    const deps: OrchestrateDeps = { startGen: fn, prisma: db };
    expect(await orchestrateBatch(deps, { ownerId: OWNER, projectId: PROJECT, batchId: "E", attemptId: ATTEMPT_A, cells: [] })).toHaveProperty("error");
    const tooMany = Array.from({ length: MAX_BATCH_CELLS + 1 }, (_, i) => genCell(`c${i}`));
    expect(await orchestrateBatch(deps, { ownerId: OWNER, projectId: PROJECT, batchId: "E2", attemptId: ATTEMPT_A, cells: tooMany })).toHaveProperty("error");
  });

  it("rejects a missing or overlong caller attempt id before any dispatch", async () => {
    const { db, jobs } = fakePrisma();
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const deps: OrchestrateDeps = { startGen: fn, prisma: db };
    expect(await orchestrateBatch(deps, {
      ownerId: OWNER, projectId: PROJECT, batchId: "A0", attemptId: "", cells: [genCell("a")],
    })).toHaveProperty("error");
    expect(await orchestrateBatch(deps, {
      ownerId: OWNER, projectId: PROJECT, batchId: "A1", attemptId: "x".repeat(65), cells: [genCell("a")],
    })).toHaveProperty("error");
    expect(calls).toHaveLength(0);
  });

  it("F1 structural: 20 cells all enqueue and it never blocks on generation completion", async () => {
    const { db, jobs } = fakePrisma();
    const fn: StartGenPort = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      const id = `j${jobs.size}`;
      jobs.set(id, { id, ownerId: OWNER, projectId: PROJECT, batchId: null, status: "QUEUED" });
      return { id, disposition: "fresh" as const };
    });
    const cells = Array.from({ length: 20 }, (_, i) => genCell(`c${i}`));
    const t0 = Date.now();
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "F1", attemptId: ATTEMPT_A, cells });
    const elapsed = Date.now() - t0;
    if ("error" in res) throw new Error(res.error);
    expect(res.dispatched).toBe(20);
    expect(res.cells.every((c) => c.status === "queued")).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("orchestrateBatch — startGen disposition + read-only material precheck", () => {
  it("reports a DONE job reused/0 only when startGen returns the atomic reused disposition", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-0", {
      id: "prior-0", ownerId: OWNER, projectId: PROJECT, batchId: "R", status: "DONE",
      idempotencyKey: factoryAttemptKey("R", 0, ATTEMPT_A).key,
      prompt: "a", model: "seedream", kind: "IMAGE", count: 1,
    });
    const { fn, calls } = spyStartGen(jobs, OWNER, (i) =>
      i === 0 ? { id: "prior-0", disposition: "reused" } : null,
    );
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "R", attemptId: ATTEMPT_A, cells: [genCell("a"), genCell("b")] });
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "reused", jobId: "prior-0", credits: 0 });
    expect(res.cells[1].status).toBe("queued");
    expect(res.reused).toBe(1);
    expect(res.dispatched).toBe(1);
    expect(res.totalCredits).toBe(1 * INTERNAL_PER_DISPLAY); // only the newly dispatched cell
    expect(calls).toHaveLength(2); // factory never infers reuse from its precheck
  });

  it("a terminal-FAILED attempt A can dispatch once under explicit retry attempt B", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("failed-0", {
      id: "failed-0", ownerId: OWNER, projectId: PROJECT, batchId: "R2", status: "FAILED",
      idempotencyKey: factoryAttemptKey("R2", 0, ATTEMPT_A).key,
      prompt: "a", model: "seedream", kind: "IMAGE", count: 1,
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "R2", attemptId: ATTEMPT_B, cells: [genCell("a")] });
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0].status).toBe("queued"); // re-dispatched, not reused
    expect(res.reused).toBe(0);
    expect(res.dispatched).toBe(1);
    expect(calls.map((c) => c.idempotencyKey)).toEqual([factoryAttemptKey("R2", 0, ATTEMPT_B).key]);
  });

  it("treats a stored empty variantSel as omitted for an explicit FAILED retry", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("failed-empty-variant", {
      id: "failed-empty-variant", ownerId: OWNER, projectId: PROJECT, batchId: "R2V", status: "FAILED",
      idempotencyKey: factoryAttemptKey("R2V", 0, ATTEMPT_A).key,
      prompt: "a", model: "seedream", kind: "IMAGE", count: 1,
      entityIds: ["e1"], variantSel: {},
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);

    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "R2V", attemptId: ATTEMPT_B, cells: [genCell("a", { entityIds: ["e1"] })] },
    );

    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "queued", credits: INTERNAL_PER_DISPLAY });
    expect(res.totalCredits).toBe(INTERNAL_PER_DISPLAY);
    expect(calls).toHaveLength(1);
  });

  it("fails closed when FAILED history has different content (no dispatch)", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-x", {
      id: "prior-x", ownerId: OWNER, projectId: PROJECT, batchId: "R3", status: "FAILED",
      idempotencyKey: factoryAttemptKey("R3", 0, ATTEMPT_A).key,
      prompt: "original", model: "seedream", kind: "IMAGE", count: 1,
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "R3", attemptId: ATTEMPT_B, cells: [genCell("DIFFERENT")] });
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0].status).toBe("error");
    expect(res.cells[0].error).toMatch(/different content/i);
    expect(res.cells[0].credits).toBe(0);
    expect(calls).toHaveLength(0); // never dispatched
  });
});

describe("orchestrateBatch — video quote never crashes the batch (NODE-280 item 2)", () => {
  it("quoteCell returns 0 (never throws) for a video cell with an absent/invalid model", () => {
    expect(() => quoteCell(genCell("v", { kind: "video" }))).not.toThrow();
    expect(quoteCell(genCell("v", { kind: "video" }))).toBe(0);
    expect(() => quoteCell(genCell("v", { kind: "video", model: "seedream" }))).not.toThrow();
    // a real video model prices via videoDefaults (seedance-2-fast: 720p/5s flat = 8 displayed)
    expect(quoteCell(genCell("v", { kind: "video", model: "seedance-2-fast" }))).toBe(8 * INTERNAL_PER_DISPLAY);
  });

  it("a mid-batch video cell with a missing model becomes a per-cell error — prior/later cells still dispatch (no throw)", async () => {
    const { db, jobs } = fakePrisma();
    const { fn } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "V", attemptId: ATTEMPT_A, cells: [genCell("before"), genCell("v", { kind: "video" }), genCell("after")] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0].status).toBe("queued");
    expect(res.cells[1]).toMatchObject({ status: "error", credits: 0 });
    expect(res.cells[2].status).toBe("queued");
    expect(res.dispatched).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.totalCredits).toBe(2 * INTERNAL_PER_DISPLAY); // only the 2 image cells
  });
});

describe("orchestrateBatch — full-field mismatch fail-closed (NODE-280-R2 ①a)", () => {
  // seedance-2-fast defaults (videoDefaults): 5s / 720p / 16:9 / fps 0 / audio on — the SAME
  // resolved form startGen persists on GenJob.videoOptions.
  const SEEDANCE_DEFAULT_VO = { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true };

  it("a changed referenceVideoGenerationId fails closed (no reuse, no dispatch)", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-rv", {
      id: "prior-rv", ownerId: OWNER, projectId: PROJECT, batchId: "M1", status: "FAILED",
      idempotencyKey: factoryAttemptKey("M1", 0, ATTEMPT_A).key,
      prompt: "clip", model: "seedance-2-fast", kind: "VIDEO", count: 1,
      referenceVideoGenerationId: "gen_A", videoOptions: SEEDANCE_DEFAULT_VO,
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M1", attemptId: ATTEMPT_B, cells: [genCell("clip", { kind: "video", model: "seedance-2-fast", referenceVideoGenerationId: "gen_B" })] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(res.cells[0].error).toMatch(/different content/i);
    expect(calls).toHaveLength(0); // never dispatched
  });

  it("a changed durationSeconds fails closed — videoOptions compared via the SAME startGen mapping (videoDefaults+overrides)", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-vo", {
      id: "prior-vo", ownerId: OWNER, projectId: PROJECT, batchId: "M2", status: "FAILED",
      idempotencyKey: factoryAttemptKey("M2", 0, ATTEMPT_A).key,
      prompt: "spin", model: "seedance-2-fast", kind: "VIDEO", count: 1,
      videoOptions: SEEDANCE_DEFAULT_VO, // stored at the 5s default
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M2", attemptId: ATTEMPT_B, cells: [genCell("spin", { kind: "video", model: "seedance-2-fast", durationSeconds: 10 })] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "error", credits: 0 }); // 10s ≠ stored 5s
    expect(res.cells[0].error).toMatch(/different content/i);
    expect(calls).toHaveLength(0);
  });

  it("changed or reordered entityIds fail closed because worker input order is material", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-e", {
      id: "prior-e", ownerId: OWNER, projectId: PROJECT, batchId: "M3", status: "FAILED",
      idempotencyKey: factoryAttemptKey("M3", 0, ATTEMPT_A).key,
      prompt: "a", model: "seedream", kind: "IMAGE", count: 1, entityIds: ["e1", "e2"],
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    // Reordering changes the worker's persisted input order → conflict before dispatch.
    const reordered = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M3", attemptId: ATTEMPT_A, cells: [genCell("a", { entityIds: ["e2", "e1"] })] },
    );
    if ("error" in reordered) throw new Error(reordered.error);
    expect(reordered.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(reordered.cells[0].error).toMatch(/different content/i);
    // A different id sequence is also different content → fail closed.
    const changed = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M3", attemptId: ATTEMPT_B, cells: [genCell("a", { entityIds: ["e1", "e2", "e3"] })] },
    );
    if ("error" in changed) throw new Error(changed.error);
    expect(changed.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(changed.cells[0].error).toMatch(/different content/i);
    expect(calls).toHaveLength(0);
  });

  it("changed non-empty variantSel values or keys remain conflict/0", async () => {
    const cases: Array<{ batchId: string; variantSel: Record<string, string> }> = [
      { batchId: "M4", variantSel: { e1: "changed", e2: "v2" } },
      { batchId: "M5", variantSel: { e1: "v1", e3: "v2" } },
    ];

    for (const { batchId, variantSel } of cases) {
      const { db, jobs } = fakePrisma();
      jobs.set(`prior-${batchId}`, {
        id: `prior-${batchId}`, ownerId: OWNER, projectId: PROJECT, batchId, status: "FAILED",
        idempotencyKey: factoryAttemptKey(batchId, 0, ATTEMPT_A).key,
        prompt: "a", model: "seedream", kind: "IMAGE", count: 1,
        entityIds: ["e1", "e2", "e3"], variantSel: { e1: "v1", e2: "v2" },
      });
      const { fn, calls } = spyStartGen(jobs, OWNER);
      const res = await orchestrateBatch(
        { startGen: fn, prisma: db },
        {
          ownerId: OWNER, projectId: PROJECT, batchId, attemptId: ATTEMPT_B,
          cells: [genCell("a", { entityIds: ["e1", "e2", "e3"], variantSel })],
        },
      );

      if ("error" in res) throw new Error(res.error);
      expect(res.cells[0]).toMatchObject({ status: "error", credits: 0 });
      expect(res.cells[0].error).toMatch(/different content/i);
      expect(res.totalCredits).toBe(0);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("money-safety: the orchestration layer never mutates credits directly", () => {
  // Strip comments first: the files DOCUMENT (in prose) that they don't touch credits, so a raw
  // grep would false-match the explanation. The invariant is about executable CODE only.
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  it("factory-batch.ts and factory-actions.ts have zero credit-mutation symbols in code", () => {
    const banned = /reserveCredits|settleCredits|refundReservation|grantCredits|creditLedger|creditAccount|CreditLedger|CreditAccount/;
    for (const rel of ["../factory-batch.ts", "../factory-actions.ts"]) {
      const code = stripComments(readFileSync(path.resolve(__dirname, rel), "utf8"));
      expect(banned.test(code), `${rel} must not touch credits directly`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// #642 修复轮 r1 P1 —— 非方图工厂批量的耐久重放
//
// 工厂批量在**每次派发之前**先读一遍这一格的历史,拿它跟本次材料比对(fail closed:
// 材料不同就拒,绝不重复扣款)。历史那一读用的是这个文件自己的一份投影常量 —— 它一旦
// 漏掉某一列,Prisma 结果里那一列**根本不存在**,比对器只好按缺省解释它,于是「同一个
// 请求」被判成「不同内容」,重试永远走不到 startGen 的锁时复用检查。
//
// 方向是安全的(拒绝而不是重复扣款),但商家的竖版批量重试从此再也点不动。
// ---------------------------------------------------------------------------
describe("#642 非方图工厂批量:同请求重试必须复用,不得误判内容不同", () => {
  it.each(["9:16", "16:9", "4:3", "21:9"])(
    "%s 竖/横版:失败后按同一份材料重试 ⇒ 照常派发,不报「内容不同」",
    async (aspectRatio) => {
      const { db, jobs } = fakePrisma();
      const batchId = `SHAPE-${aspectRatio}`;
      jobs.set("prior-shape", {
        id: "prior-shape", ownerId: OWNER, projectId: PROJECT, batchId, status: "FAILED",
        idempotencyKey: factoryAttemptKey(batchId, 0, ATTEMPT_A).key,
        prompt: "a poster", model: "seedream", kind: "IMAGE", count: 1,
        imageOptions: { aspectRatio },
      });
      const { fn, calls } = spyStartGen(jobs, OWNER);

      const res = await orchestrateBatch(
        { startGen: fn, prisma: db },
        {
          ownerId: OWNER, projectId: PROJECT, batchId, attemptId: ATTEMPT_B,
          cells: [genCell("a poster", { aspectRatio })],
        },
      );

      if ("error" in res) throw new Error(res.error);
      expect(res.cells[0], `${aspectRatio} 必须被判为同一份材料`).toMatchObject({ status: "queued", credits: INTERNAL_PER_DISPLAY });
      expect(res.cells[0].error).toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.aspectRatio).toBe(aspectRatio); // 形状一路带到 startGen
    },
  );

  it("方图(默认)那条路照旧 —— 证明上面的红不是「全都通过」换来的", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-square", {
      id: "prior-square", ownerId: OWNER, projectId: PROJECT, batchId: "SQ", status: "FAILED",
      idempotencyKey: factoryAttemptKey("SQ", 0, ATTEMPT_A).key,
      prompt: "a poster", model: "seedream", kind: "IMAGE", count: 1,
      imageOptions: { aspectRatio: "1:1" },
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "SQ", attemptId: ATTEMPT_B, cells: [genCell("a poster")] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "queued", credits: INTERNAL_PER_DISPLAY });
    expect(calls).toHaveLength(1);
  });

  it("真换了形状仍然 fail closed —— 修好重放不等于放松材料把关", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-changed", {
      id: "prior-changed", ownerId: OWNER, projectId: PROJECT, batchId: "SC", status: "FAILED",
      idempotencyKey: factoryAttemptKey("SC", 0, ATTEMPT_A).key,
      prompt: "a poster", model: "seedream", kind: "IMAGE", count: 1,
      imageOptions: { aspectRatio: "9:16" },
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "SC", attemptId: ATTEMPT_B, cells: [genCell("a poster", { aspectRatio: "16:9" })] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(res.cells[0].error).toMatch(/different content/i);
    expect(calls).toHaveLength(0); // 从未派发 ⇒ 从未重复扣款
  });

  it("迁移前的历史行(该列为 NULL)按方图解释,老批量重放照旧", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-legacy", {
      id: "prior-legacy", ownerId: OWNER, projectId: PROJECT, batchId: "LG", status: "FAILED",
      idempotencyKey: factoryAttemptKey("LG", 0, ATTEMPT_A).key,
      prompt: "a poster", model: "seedream", kind: "IMAGE", count: 1,
      imageOptions: null,
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "LG", attemptId: ATTEMPT_B, cells: [genCell("a poster")] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "queued" });
    expect(calls).toHaveLength(1);
  });
});
