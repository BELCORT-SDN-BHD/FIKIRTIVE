/**
 * run-factory-batch.test.ts — gating + routing tests for the factory batch spend skill (W-B3-F-P).
 * Injects a mock ctx.runFactoryBatch port; asserts the machine-derived approval gate, that scope
 * comes from ctx (not the model), and that each mode routes to the matching owner-scoped action.
 */
import { describe, it, expect, vi } from "vitest";
import { runFactoryBatchSkill, runFactoryBatchInput, executeRunFactoryBatch } from "./run-factory-batch.js";
import type { OttoContext } from "../context.js";

function okResult(batchId: string) {
  return { batchId, cells: [], totalCredits: 0, dispatched: 0, reused: 0, failed: 0 };
}

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-from-ctx",
    threadId: "thread-test",
    disabledModels: [],
    runFactoryBatch: {
      variant: vi.fn(async () => okResult("b1")),
      bulk: vi.fn(async () => okResult("b1")),
    },
    ...overrides,
  } as unknown as OttoContext;
}

describe("runFactoryBatch skill — the spend gate", () => {
  it("is machine-derived cost:spend → needsApproval:true (反翻转, same as generate)", () => {
    expect(runFactoryBatchSkill.cost).toBe("spend");
    expect(runFactoryBatchSkill.effect).toBe("write");
    expect(runFactoryBatchSkill.reach).toBe("internal");
    expect(runFactoryBatchSkill.needsApproval).toBe(true);
    expect(runFactoryBatchSkill.name).toBe("runFactoryBatch");
  });

  it("never accepts identity, projectId, or the server attempt token from the model", () => {
    const keys = Object.keys(runFactoryBatchInput.shape);
    for (const forbidden of ["orgId", "ownerId", "userId", "projectId", "attemptId"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(runFactoryBatchInput.safeParse({
      mode: "grid",
      batchId: "B",
      attemptId: "model-controlled",
      cells: [{ type: "gen", prompt: "a" }],
    }).success).toBe(false);
  });
});

describe("runFactoryBatch skill — routing through the owner-scoped port", () => {
  it("variant mode calls ctx.runFactoryBatch.variant with the ctx projectId", async () => {
    const ctx = makeCtx();
    const res = await executeRunFactoryBatch(
      { mode: "variant", batchId: "B", name: "Ads", base: { prompt: "a" }, variants: [{}, { prompt: "b" }] },
      { context: ctx },
    );
    expect(ctx.runFactoryBatch!.variant).toHaveBeenCalledTimes(1);
    expect(ctx.runFactoryBatch!.variant).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "B", projectId: "proj-from-ctx", name: "Ads", base: { prompt: "a" }, variants: [{}, { prompt: "b" }] }),
    );
    expect(ctx.runFactoryBatch!.bulk).not.toHaveBeenCalled();
    expect(res).toMatchObject({ batchId: "b1" });
  });

  it("grid mode calls ctx.runFactoryBatch.bulk with the cells + ctx projectId", async () => {
    const ctx = makeCtx();
    await executeRunFactoryBatch(
      { mode: "grid", batchId: "B", cells: [{ type: "gen", prompt: "a" }, { type: "text", text: "Sale" }] },
      { context: ctx },
    );
    expect(ctx.runFactoryBatch!.bulk).toHaveBeenCalledTimes(1);
    expect(ctx.runFactoryBatch!.bulk).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "B", projectId: "proj-from-ctx", cells: [{ type: "gen", prompt: "a" }, { type: "text", text: "Sale" }] }),
    );
    expect(ctx.runFactoryBatch!.variant).not.toHaveBeenCalled();
  });

  it("variant mode without a base or variants refuses (no port call)", async () => {
    const ctx = makeCtx();
    expect(await executeRunFactoryBatch({ mode: "variant" as const, batchId: "B", variants: [{}] }, { context: ctx })).toHaveProperty("error");
    expect(await executeRunFactoryBatch({ mode: "variant" as const, batchId: "B", base: { prompt: "a" } }, { context: ctx })).toHaveProperty("error");
    expect(ctx.runFactoryBatch!.variant).not.toHaveBeenCalled();
  });

  it("grid mode without cells refuses (no port call)", async () => {
    const ctx = makeCtx();
    expect(await executeRunFactoryBatch({ mode: "grid" as const, batchId: "B", cells: [] }, { context: ctx })).toHaveProperty("error");
    expect(ctx.runFactoryBatch!.bulk).not.toHaveBeenCalled();
  });

  it("degrades gracefully when the port is not injected", async () => {
    const ctx = makeCtx({ runFactoryBatch: undefined });
    const res = await executeRunFactoryBatch({ mode: "grid", batchId: "B", cells: [{ type: "gen", prompt: "a" }] }, { context: ctx });
    expect(res).toHaveProperty("error");
  });
});

describe("#777 runFactoryBatch — Otto 判断「这是一组要连贯的图」", () => {
  it("组图那一格随 cell 原样送进 owner-scoped 动作层(模型只说要做什么)", async () => {
    const ctx = makeCtx();
    await executeRunFactoryBatch(
      { mode: "grid", batchId: "B", cells: [{ type: "gen", prompt: "one model, four angles", count: 4, coherentSet: true }] },
      { context: ctx },
    );
    expect(ctx.runFactoryBatch!.bulk).toHaveBeenCalledWith(
      expect.objectContaining({
        cells: [{ type: "gen", prompt: "one model, four angles", count: 4, coherentSet: true }],
      }),
    );
  });

  it("variant 模式:base 上开一次,整批变体都成组", async () => {
    const ctx = makeCtx();
    await executeRunFactoryBatch(
      { mode: "variant", batchId: "B", base: { prompt: "one model", count: 3, coherentSet: true }, variants: [{}, {}] },
      { context: ctx },
    );
    expect(ctx.runFactoryBatch!.variant).toHaveBeenCalledWith(
      expect.objectContaining({ base: { prompt: "one model", count: 3, coherentSet: true } }),
    );
  });

  it("缺省时这一格根本不出现 —— 既有批次的形状逐字不变", async () => {
    const ctx = makeCtx();
    await executeRunFactoryBatch(
      { mode: "grid", batchId: "B", cells: [{ type: "gen", prompt: "four hooks", count: 4 }] },
      { context: ctx },
    );
    const sent = (ctx.runFactoryBatch!.bulk as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock.calls[0]![0];
    expect("coherentSet" in ((sent.cells as Record<string, unknown>[])[0]!)).toBe(false);
  });

  it("技能说明里真的教了这件事 —— 模型看不到的能力等于没有这个能力", () => {
    // 这一格是**模型自己判断**要不要用的,所以「什么时候用」必须写在它读得到的地方。
    expect(runFactoryBatchSkill.description).toContain("ONE SET");
    expect(runFactoryBatchSkill.description).toContain("coherentSet");
    // 而且必须说清价格不变 —— 否则模型会把它当成一个更贵的选项而回避。
    expect(runFactoryBatchSkill.description).toMatch(/same price per image/i);
  });

  it("契约面:仍然是布尔,且不接受模型塞进来的任何身份字段(这一格没有开新口子)", () => {
    expect(runFactoryBatchInput.safeParse({
      mode: "grid", batchId: "B", cells: [{ type: "gen", prompt: "a", coherentSet: "yes" }],
    }).success).toBe(false);
    expect(runFactoryBatchInput.safeParse({
      mode: "grid", batchId: "B", cells: [{ type: "gen", prompt: "a", coherentSet: true }],
    }).success).toBe(true);
  });
});
