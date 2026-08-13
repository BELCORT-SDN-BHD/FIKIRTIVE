/**
 * recall-store-knowledge.test.ts — #784 Otto 取回后台读懂的素材。
 *
 * 两条承重的:**只读自己租户**、**嘴上不许有「分析」这个动作**(票面铁律)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: { assetUnderstanding: { findMany: mocks.findMany } } }));

import { executeRecallStoreKnowledge, recallStoreKnowledgeSkill, recallStoreKnowledgeParams } from "./recall-store-knowledge.js";

const ctx = { context: { orgId: "owner-1" } } as never;

function stored(over: Record<string, unknown> = {}) {
  return {
    assetId: "a-1",
    kind: "image-caption",
    summary: "A ceramic mug on a linen cloth.",
    data: { category: "homeware", colors: ["warm neutral"] },
    createdAt: new Date("2026-08-13T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([stored()]);
});

describe("租户", () => {
  it("查询永远带 ctx 的 orgId,而且只取已经读完的行", async () => {
    await executeRecallStoreKnowledge({}, ctx);
    expect(mocks.findMany.mock.calls[0]![0].where).toMatchObject({ ownerId: "owner-1", status: "DONE" });
  });

  it("参数里没有任何身份字段(defineOttoSkill 会拒,这里再钉一次)", () => {
    const shape = Object.keys(recallStoreKnowledgeParams.shape);
    for (const k of ["ownerId", "orgId", "userId", "tenantId"]) expect(shape).not.toContain(k);
  });
});

describe("分类与筛选", () => {
  it("kind 传了就只查那一类", async () => {
    await executeRecallStoreKnowledge({ kind: "doc-extract" }, ctx);
    expect(mocks.findMany.mock.calls[0]![0].where.kind).toBe("doc-extract");
  });

  it("query 按商家自己的词汇匹配 summary 与结构化产物", async () => {
    mocks.findMany.mockResolvedValue([
      stored({ assetId: "a-mug", summary: "A ceramic mug." }),
      stored({ assetId: "a-menu", summary: "A printed menu.", data: { category: "menu" } }),
    ]);
    const out = await executeRecallStoreKnowledge({ query: "menu" }, ctx);
    expect(out.understood.map((u) => u.assetId)).toEqual(["a-menu"]);
  });

  it("条数封顶 —— 素材库会一直长,上下文不会", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 50 }, (_, i) => stored({ assetId: `a-${i}` })));
    expect((await executeRecallStoreKnowledge({ limit: 3 }, ctx)).understood).toHaveLength(3);
    expect((await executeRecallStoreKnowledge({}, ctx)).understood.length).toBeLessThanOrEqual(12);
  });
});

describe("产物", () => {
  it("回的是 assetId + 一句人话 + 结构化细节", async () => {
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.understood[0]).toMatchObject({
      assetId: "a-1",
      kind: "image-caption",
      summary: "A ceramic mug on a linen cloth.",
      details: { category: "homeware" },
    });
    expect(out.understood[0]!.readAt).toBe("2026-08-13T00:00:00.000Z");
  });

  it("白标兜底:落盘漏过去的供应商名在出口再被擦一次", async () => {
    mocks.findMany.mockResolvedValue([stored({ summary: "seedream saw a mug" })]);
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.understood[0]!.summary.toLowerCase()).not.toContain("seedream");
  });
});

describe("商家永远不点「分析」(票面铁律)", () => {
  it("什么都还没读到时,给模型的提示明令不许提议去分析", async () => {
    mocks.findMany.mockResolvedValue([]);
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.understood).toEqual([]);
    expect(out.note?.toLowerCase()).toMatch(/automatically/);
    expect(out.note?.toLowerCase()).toMatch(/never offer/);
  });

  it("skill 描述本身把这条铁律讲给模型听,而且它是只读免费不需审批的", () => {
    expect(recallStoreKnowledgeSkill.cost).toBe("free");
    expect(recallStoreKnowledgeSkill.effect).toBe("read");
    expect(recallStoreKnowledgeSkill.needsApproval).toBe(false);
    expect(recallStoreKnowledgeSkill.description.toLowerCase()).toMatch(/no analyse button|never offer to analyse/);
  });
});
