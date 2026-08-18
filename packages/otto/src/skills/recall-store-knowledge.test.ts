/**
 * recall-store-knowledge.test.ts — #784 Otto 取回后台读懂的素材。
 *
 * 两条承重的:**只读自己租户**、**嘴上不许有「分析」这个动作**(票面铁律)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UNDERSTANDING_PROVIDER_PAUSED } from "@fikirtive/core";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: { assetUnderstanding: { findMany: mocks.findMany } } }));

import { executeRecallStoreKnowledge, recallStoreKnowledgeSkill, recallStoreKnowledgeParams } from "./recall-store-knowledge.js";

const ctx = { context: { orgId: "owner-1" } } as never;

function stored(over: Record<string, unknown> = {}) {
  return {
    assetId: "a-1",
    kind: "image-caption",
    status: "DONE",
    summary: "A ceramic mug on a linen cloth.",
    data: { category: "homeware", colors: ["warm neutral"] },
    error: null,
    createdAt: new Date("2026-08-13T00:00:00Z"),
    ...over,
  };
}

/** 一件试过但读不成的素材(终态 —— 它不会自己重来)。 */
function unread(over: Record<string, unknown> = {}) {
  return stored({
    assetId: "a-huge",
    status: "SKIPPED",
    summary: "",
    data: null,
    error: "That picture is larger than the reading budget covers, so it was left unread.",
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([stored()]);
});

describe("租户", () => {
  it("查询永远带 ctx 的 orgId,而且只取已经有结论的行(读成的 + 读不成的)", async () => {
    await executeRecallStoreKnowledge({}, ctx);
    const where = mocks.findMany.mock.calls[0]![0].where;
    expect(where.ownerId).toBe("owner-1");
    // 还在排队/在跑的行不进来 —— 它们既不是知识,也还没有结论
    expect(where.status.in).toEqual(expect.arrayContaining(["DONE", "SKIPPED", "FAILED"]));
    expect(where.status.in).not.toContain("QUEUED");
    expect(where.status.in).not.toContain("RUNNING");
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

describe("读不成的素材要如实说(不许说「稍后会自动读」)", () => {
  it("只有读不成的素材时,原因如实带出来,并且**不**承诺以后会读", async () => {
    mocks.findMany.mockResolvedValue([unread()]);
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.understood).toEqual([]);
    expect(out.notRead).toEqual([
      {
        assetId: "a-huge",
        kind: "image-caption",
        reason: "That picture is larger than the reading budget covers, so it was left unread.",
      },
    ]);
    const note = out.note!.toLowerCase();
    // 这一条就是 r2 的谎:一件永远不会再被读的素材,商家听到的是「稍后会自动读」
    expect(note).not.toMatch(/read automatically|shortly after they arrive/);
    expect(note).toMatch(/not be retried|do not promise/);
    expect(note).toMatch(/never offer/); // 铁律照旧
  });

  it("读成的和读不成的混在一起时,读不成的**不许被隐去**", async () => {
    mocks.findMany.mockResolvedValue([stored(), unread({ status: "FAILED", error: "That file couldn't be read clearly enough to use." })]);
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.understood.map((u) => u.assetId)).toEqual(["a-1"]);
    expect(out.notRead?.map((u) => u.assetId)).toEqual(["a-huge"]);
    expect(out.note?.toLowerCase()).toMatch(/not be retried/);
  });

  it("读不成的那一句也过白标兜底", async () => {
    mocks.findMany.mockResolvedValue([unread({ error: "seedream rejected the file" })]);
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.notRead![0]!.reason.toLowerCase()).not.toContain("seedream");
  });

  it("全都读成时不多出一个空的 notRead 字段", async () => {
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.notRead).toBeUndefined();
    expect(out.waitingOnUs).toBeUndefined();
    expect(out.note).toBeUndefined();
  });
});

/**
 * 2026-08-18 事故里 Otto 说的那句谎:每一份**好**文件都被讲成「读不了,建议传更清晰的
 * 版本」。文件从头到尾没有任何问题,坏的是我们自己的配置 —— 商家重传多少次都是同一个结果。
 * 所以「不会重试」这句话只许跟着真的不会重试的那一类出现。
 */
describe("我方还没修好的文件:说的是另一句实话", () => {
  it("PAUSED 的行走 waitingOnUs,不混进 notRead", async () => {
    mocks.findMany.mockResolvedValue([
      unread({ assetId: "a-waiting", status: "PAUSED", error: UNDERSTANDING_PROVIDER_PAUSED }),
    ]);
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.notRead).toBeUndefined();
    expect(out.waitingOnUs).toEqual([
      { assetId: "a-waiting", kind: "image-caption", reason: UNDERSTANDING_PROVIDER_PAUSED },
    ]);
  });

  it("给模型的那句话里没有「不会重试」,也没有「传一份更清楚的」", async () => {
    mocks.findMany.mockResolvedValue([
      unread({ assetId: "a-waiting", status: "PAUSED", error: UNDERSTANDING_PROVIDER_PAUSED }),
    ]);
    const note = (await executeRecallStoreKnowledge({}, ctx)).note!.toLowerCase();
    expect(note).not.toMatch(/not be retried/);
    expect(note).not.toMatch(/clearer or smaller/);
    expect(note).toMatch(/still in line|will be read once/);
    expect(note).toMatch(/never ask the user to re-upload/);
  });

  it("两类同时在场时,两句话各说各的,谁也不代表谁", async () => {
    mocks.findMany.mockResolvedValue([
      unread({ assetId: "a-huge", status: "SKIPPED" }),
      unread({ assetId: "a-waiting", status: "PAUSED", error: UNDERSTANDING_PROVIDER_PAUSED }),
    ]);
    const out = await executeRecallStoreKnowledge({}, ctx);
    expect(out.notRead?.map((f) => f.assetId)).toEqual(["a-huge"]);
    expect(out.waitingOnUs?.map((f) => f.assetId)).toEqual(["a-waiting"]);
    const note = out.note!;
    // 「不会重试」必须**指名**它管的是哪一堆 —— 不指名就等于把两类都说死了
    expect(note).toMatch(/`notRead`[^]*will NOT be retried/);
    expect(note).toMatch(/`waitingOnUs`[^]*will be read once/);
  });

  it("查询把 PAUSED 一并取回来 —— 取不回来就等于对商家隐去了这一整类", async () => {
    await executeRecallStoreKnowledge({}, ctx);
    expect(mocks.findMany.mock.calls[0]![0].where.status.in).toContain("PAUSED");
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
