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

type JobRow = {
  id: string; ownerId: string; batchId: string | null; status: string; idempotencyKey?: string;
  prompt?: string; model?: string; kind?: string; count?: number;
  entityIds?: string[]; variantSel?: Record<string, string> | null;
  sourceGenerationId?: string | null; tailGenerationId?: string | null;
  referenceVideoGenerationId?: string | null; shotId?: string | null;
  videoOptions?: Record<string, unknown> | null;
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
      findMany: vi.fn(async ({ where }: { where: { ownerId: string; batchId: string } }) =>
        [...jobs.values()].filter((j) => j.ownerId === where.ownerId && j.batchId === where.batchId).map((j) => ({ status: j.status })),
      ),
    },
  } as unknown as OrchestrateDeps["prisma"];
  return { db, jobs };
}

// A startGen spy that records every request and mints a job row in the fake prisma so
// the batchId tag has something to write to.
function spyStartGen(jobs: Map<string, JobRow>, ownerId: string, override?: (i: number) => { error: string } | null) {
  let n = 0;
  const calls: Record<string, unknown>[] = [];
  const fn: StartGenPort = vi.fn(async (req: Record<string, unknown>) => {
    const idx = n++;
    calls.push(req);
    const over = override?.(idx) ?? null;
    if (over) return over;
    const id = `job-${idx}`;
    jobs.set(id, { id, ownerId, batchId: null, status: "QUEUED" });
    return { id };
  });
  return { fn, calls };
}

const OWNER = "org_test";
const PROJECT = "prj_test";

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
  it("derives per-cell idempotency keys batch:<batchId>:cell:<n> and sums the quote", async () => {
    const { db, jobs } = fakePrisma();
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "B1", cells: [genCell("a"), genCell("b"), genCell("c")] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.dispatched).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.totalCredits).toBe(3 * INTERNAL_PER_DISPLAY);
    expect(calls.map((c) => c.idempotencyKey)).toEqual(["batch:B1:cell:0", "batch:B1:cell:1", "batch:B1:cell:2"]);
    expect(calls.every((c) => c.projectId === PROJECT)).toBe(true);
    expect(res.cells.every((c) => c.status === "queued" && c.credits === INTERNAL_PER_DISPLAY)).toBe(true);
  });

  it("text cells are $0 and never enter startGen", async () => {
    const { db, jobs } = fakePrisma();
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const cells: BatchCell[] = [{ type: "text", text: "Big Sale" }, genCell("product on white")];
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "B2", cells });
    if ("error" in res) throw new Error(res.error);
    expect(calls).toHaveLength(1);
    expect(res.cells[0]).toMatchObject({ type: "text", status: "text", credits: 0 });
    expect(res.cells[1]).toMatchObject({ type: "gen", status: "queued", credits: INTERNAL_PER_DISPLAY });
    expect(res.totalCredits).toBe(INTERNAL_PER_DISPLAY);
  });

  it("a replay with the SAME batchId reproduces the SAME per-cell keys (dedup anchor)", async () => {
    const { db, jobs } = fakePrisma();
    const a = spyStartGen(jobs, OWNER);
    await orchestrateBatch({ startGen: a.fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "SAME", cells: [genCell("a"), genCell("b")] });
    const b = spyStartGen(jobs, OWNER);
    await orchestrateBatch({ startGen: b.fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "SAME", cells: [genCell("a"), genCell("b")] });
    expect(a.calls.map((c) => c.idempotencyKey)).toEqual(b.calls.map((c) => c.idempotencyKey));
    expect(b.calls.map((c) => c.idempotencyKey)).toEqual(["batch:SAME:cell:0", "batch:SAME:cell:1"]);
  });

  it("partial dispatch failure marks only the failed cells — no batch-level rollback", async () => {
    const { db, jobs } = fakePrisma();
    const { fn } = spyStartGen(jobs, OWNER, (i) => (i === 1 ? { error: "no" } : null));
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "B3", cells: [genCell("a"), genCell("b"), genCell("c")] },
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
    expect(await orchestrateBatch(deps, { ownerId: OWNER, projectId: PROJECT, batchId: "E", cells: [] })).toHaveProperty("error");
    const tooMany = Array.from({ length: MAX_BATCH_CELLS + 1 }, (_, i) => genCell(`c${i}`));
    expect(await orchestrateBatch(deps, { ownerId: OWNER, projectId: PROJECT, batchId: "E2", cells: tooMany })).toHaveProperty("error");
  });

  it("F1 structural: 20 cells all enqueue and it never blocks on generation completion", async () => {
    const { db, jobs } = fakePrisma();
    const fn: StartGenPort = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      const id = `j${jobs.size}`;
      jobs.set(id, { id, ownerId: OWNER, batchId: null, status: "QUEUED" });
      return { id };
    });
    const cells = Array.from({ length: 20 }, (_, i) => genCell(`c${i}`));
    const t0 = Date.now();
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "F1", cells });
    const elapsed = Date.now() - t0;
    if ("error" in res) throw new Error(res.error);
    expect(res.dispatched).toBe(20);
    expect(res.cells.every((c) => c.status === "queued")).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("orchestrateBatch — any-status replay precheck (NODE-280 item 1)", () => {
  it("reuses an existing DONE job for the same key (zero new charge) and skips startGen", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-0", { id: "prior-0", ownerId: OWNER, batchId: "R", status: "DONE", idempotencyKey: "batch:R:cell:0", prompt: "a", model: "seedream", kind: "IMAGE", count: 1 });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "R", cells: [genCell("a"), genCell("b")] });
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "reused", jobId: "prior-0", credits: 0 });
    expect(res.cells[1].status).toBe("queued");
    expect(res.reused).toBe(1);
    expect(res.dispatched).toBe(1);
    expect(res.totalCredits).toBe(1 * INTERNAL_PER_DISPLAY); // only the newly dispatched cell
    expect(calls.map((c) => c.idempotencyKey)).toEqual(["batch:R:cell:1"]); // startGen never called for cell 0
  });

  it("re-dispatches a terminal-FAILED cell (legitimate retry) instead of reusing it", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("failed-0", { id: "failed-0", ownerId: OWNER, batchId: "R2", status: "FAILED", idempotencyKey: "batch:R2:cell:0", prompt: "a", model: "seedream", kind: "IMAGE", count: 1 });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "R2", cells: [genCell("a")] });
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0].status).toBe("queued"); // re-dispatched, not reused
    expect(res.reused).toBe(0);
    expect(res.dispatched).toBe(1);
    expect(calls.map((c) => c.idempotencyKey)).toEqual(["batch:R2:cell:0"]);
  });

  it("fails closed when a batchId is reused for DIFFERENT content (no reuse, no dispatch)", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-x", { id: "prior-x", ownerId: OWNER, batchId: "R3", status: "QUEUED", idempotencyKey: "batch:R3:cell:0", prompt: "original", model: "seedream", kind: "IMAGE", count: 1 });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch({ startGen: fn, prisma: db }, { ownerId: OWNER, projectId: PROJECT, batchId: "R3", cells: [genCell("DIFFERENT")] });
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
      { ownerId: OWNER, projectId: PROJECT, batchId: "V", cells: [genCell("before"), genCell("v", { kind: "video" }), genCell("after")] },
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
      id: "prior-rv", ownerId: OWNER, batchId: "M1", status: "QUEUED", idempotencyKey: "batch:M1:cell:0",
      prompt: "clip", model: "seedance-2-fast", kind: "VIDEO", count: 1,
      referenceVideoGenerationId: "gen_A", videoOptions: SEEDANCE_DEFAULT_VO,
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M1", cells: [genCell("clip", { kind: "video", model: "seedance-2-fast", referenceVideoGenerationId: "gen_B" })] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(res.cells[0].error).toMatch(/different content/i);
    expect(calls).toHaveLength(0); // never dispatched
  });

  it("a changed durationSeconds fails closed — videoOptions compared via the SAME startGen mapping (videoDefaults+overrides)", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-vo", {
      id: "prior-vo", ownerId: OWNER, batchId: "M2", status: "DONE", idempotencyKey: "batch:M2:cell:0",
      prompt: "spin", model: "seedance-2-fast", kind: "VIDEO", count: 1,
      videoOptions: SEEDANCE_DEFAULT_VO, // stored at the 5s default
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    const res = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M2", cells: [genCell("spin", { kind: "video", model: "seedance-2-fast", durationSeconds: 10 })] },
    );
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "error", credits: 0 }); // 10s ≠ stored 5s
    expect(res.cells[0].error).toMatch(/different content/i);
    expect(calls).toHaveLength(0);
  });

  it("changed entityIds fail closed; REORDERED entityIds still reuse (order-normalized compare)", async () => {
    const { db, jobs } = fakePrisma();
    jobs.set("prior-e", {
      id: "prior-e", ownerId: OWNER, batchId: "M3", status: "QUEUED", idempotencyKey: "batch:M3:cell:0",
      prompt: "a", model: "seedream", kind: "IMAGE", count: 1, entityIds: ["e1", "e2"],
    });
    const { fn, calls } = spyStartGen(jobs, OWNER);
    // Reordered ids = the same content → reuse (zero dispatch, zero new charge).
    const reordered = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M3", cells: [genCell("a", { entityIds: ["e2", "e1"] })] },
    );
    if ("error" in reordered) throw new Error(reordered.error);
    expect(reordered.cells[0]).toMatchObject({ status: "reused", jobId: "prior-e", credits: 0 });
    // A different id SET = different content → fail closed.
    const changed = await orchestrateBatch(
      { startGen: fn, prisma: db },
      { ownerId: OWNER, projectId: PROJECT, batchId: "M3", cells: [genCell("a", { entityIds: ["e1", "e2", "e3"] })] },
    );
    if ("error" in changed) throw new Error(changed.error);
    expect(changed.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(changed.cells[0].error).toMatch(/different content/i);
    expect(calls).toHaveLength(0); // neither run dispatched
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
