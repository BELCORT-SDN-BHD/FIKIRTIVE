/**
 * understand.test.ts — #784 素材理解的后台执行器。
 *
 * 断言的都是这条链路上会真的出事的地方:
 *  - **商家一分钱不付**:reserveCredits / settleCredits / refundReservation / withLlmBudget
 *    一次都不许被调用(spy 全程盯着)。
 *  - **不重复读**:重投时 CAS 输掉 ⇒ 连供应商都不打。
 *  - **闸门在花钱之前**:总开关关、平台预算见底、视频太长、图片太大 —— provider 一次不调。
 *  - **暂缓 ≠ 丢弃**:资源类原因退回 QUEUED,下一轮/次日照样读得到;终态只留真终局。
 *  - **解析失败兜底**(票面明写):doc-extract 读不出来 ⇒ 一行 BrandRecord 都不写。
 *  - **租户**:每一次读写都带 ownerId。
 *
 * 最下面那一组(「一次导入两千张,最终一张都不会漏」)跑的是一个**内存假库**:多轮推进,
 * 断言的是主张本身(全部会被读到),不是注释的措辞。上一版只断言 `take <= 50` ——
 * 那条断言在「其余 1950 张被逐一写死」的实现下也是绿的。
 *
 * 纪律:**供应商全程 mock,一次都不真调。**
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const assetUnderstanding = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  };
  const asset = { findMany: vi.fn(), findFirst: vi.fn() };
  const brandRecord = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const memory = { findFirst: vi.fn(), create: vi.fn() };

  // 这四个是**绝对不许**被调用的 —— 理解是平台成本,不进商家账本。
  const reserveCredits = vi.fn();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();

  const presignedGet = vi.fn();
  const understand = vi.fn();

  return {
    prisma: { assetUnderstanding, asset, brandRecord, memory },
    assetUnderstanding, asset, brandRecord, memory,
    reserveCredits, settleCredits, refundReservation,
    presignedGet, understand,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: mocks.prisma,
  reserveCredits: mocks.reserveCredits,
  settleCredits: mocks.settleCredits,
  refundReservation: mocks.refundReservation,
}));

// 真身份帧太重,这里只保留「回调真的被跑了」这一点 —— 租户断言看的是每一次调用的 where。
vi.mock("@fikirtive/db/principal", () => ({
  runAsSystem: (_reason: string, fn: () => unknown) => fn(),
  runAsTenant: (_ownerId: string, fn: () => unknown) => fn(),
}));

vi.mock("../storage.js", () => ({ storage: { presignedGet: mocks.presignedGet } }));

import { unreadableMediaError } from "@fikirtive/generation";
import { understandingCostUsd } from "@fikirtive/core";
import {
  handleUnderstand,
  scanAssetsNeedingUnderstanding,
  understandingSpentTodayUsd,
  reapStaleUnderstanding,
} from "./understand.js";

const OWNER = "owner-1";
const ASSET = "asset-1";

const port = { name: "mock", understand: mocks.understand };

function row(kind: string, over: Record<string, unknown> = {}) {
  return { id: "u-1", ownerId: OWNER, assetId: ASSET, kind, status: "QUEUED", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASSET_UNDERSTANDING;
  delete process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD;
  mocks.assetUnderstanding.updateMany.mockResolvedValue({ count: 1 }); // CAS 默认赢
  mocks.assetUnderstanding.count.mockResolvedValue(1);
  mocks.assetUnderstanding.create.mockResolvedValue({});
  mocks.assetUnderstanding.findMany.mockResolvedValue([]);
  mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } });
  mocks.asset.findFirst.mockResolvedValue({
    contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg",
    durationS: null, width: 1600, height: 1200, sizeBytes: BigInt(400_000), deletedAt: null,
  });
  mocks.asset.findMany.mockResolvedValue([]);
  mocks.brandRecord.findFirst.mockResolvedValue(null);
  mocks.brandRecord.create.mockResolvedValue({});
  mocks.memory.findFirst.mockResolvedValue(null);
  mocks.memory.create.mockResolvedValue({});
  mocks.presignedGet.mockResolvedValue("https://r2.example/obj?sig=x");
  mocks.understand.mockResolvedValue({
    text: JSON.stringify({ summary: "A ceramic mug", category: "homeware", isDocument: false }),
    usage: { inputTokens: 900, outputTokens: 60 },
  });
});

/** 每个用例跑完都复核一次:商家的余额一格没动。 */
function expectNoCreditCalls() {
  expect(mocks.reserveCredits).not.toHaveBeenCalled();
  expect(mocks.settleCredits).not.toHaveBeenCalled();
  expect(mocks.refundReservation).not.toHaveBeenCalled();
}

describe("商家一分钱不付", () => {
  it("跑完一整趟,credit 三个入口一次都没被碰", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).toHaveBeenCalledTimes(1);
    expectNoCreditCalls();
  });
});

describe("不重复读(幂等)", () => {
  it("重投时 CAS 输掉 ⇒ 连供应商都不打", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption", { status: "RUNNING" }));
    mocks.assetUnderstanding.updateMany.mockResolvedValue({ count: 0 });
    await handleUnderstand({ understandingId: "u-1" }, 1, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.brandRecord.create).not.toHaveBeenCalled();
    expect(mocks.memory.create).not.toHaveBeenCalled();
    expectNoCreditCalls();
  });

  it("CAS 只认 QUEUED 那一行 —— where 里写死了状态", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    const cas = mocks.assetUnderstanding.updateMany.mock.calls[0]![0];
    expect(cas.where).toMatchObject({ id: "u-1", ownerId: OWNER, status: "QUEUED" });
    expect(cas.data).toEqual({ status: "RUNNING" });
  });

  it("行不存在就丢掉,不炸", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(null);
    await expect(handleUnderstand({ understandingId: "nope" }, 0, port)).resolves.toBeNull();
    expect(mocks.understand).not.toHaveBeenCalled();
  });
});

describe("闸门都在花钱之前(真终局落 SKIPPED)", () => {
  it("视频比理解预算覆盖得住的还长 ⇒ SKIPPED —— 这道闸是「1%」能成立的前提", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("video-qa"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "mp4", mime: "video/mp4",
      durationS: 600, width: 1920, height: 1080, sizeBytes: BigInt(90_000_000), deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
  });

  it("图片大过 pre-flight 闸 ⇒ 一个请求都不发就被拒(和视频时长闸对称)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg",
      durationS: null, width: 8064, height: 6048, sizeBytes: BigInt(20_000_000), deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    // 零请求:连 presigned URL 都没签,更没打供应商 —— 一分钱没花
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.presignedGet).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
    expectNoCreditCalls();
  });

  it("同一道闸也管 doc-extract —— 它读的是同一张图", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("doc-extract"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "png", mime: "image/png",
      durationS: null, width: null, height: null, sizeBytes: BigInt(120 * 1024 * 1024), deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.presignedGet).not.toHaveBeenCalled();
  });

  it("闸门以内的普通照片照跑(闸不该挡住最常见的那张照片)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg",
      durationS: null, width: 4032, height: 3024, sizeBytes: BigInt(3_500_000), deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).toHaveBeenCalledTimes(1);
  });

  it("素材已被删 ⇒ SKIPPED", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg",
      durationS: null, width: 1600, height: 1200, sizeBytes: BigInt(400_000), deletedAt: new Date(),
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
  });
});

describe("资源类原因是暂缓,不是丢弃", () => {
  it("总开关关掉 ⇒ 行退回 QUEUED(暂停键不是销毁键),供应商一次不调", async () => {
    process.env.ASSET_UNDERSTANDING = "off";
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("QUEUED");
    expect(last.data.status).not.toBe("SKIPPED");
    expectNoCreditCalls();
  });

  it("签不出 URL ⇒ 行退回 QUEUED —— 存储抖一下不该让那批素材永久失忆", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.presignedGet.mockResolvedValue(null);
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("QUEUED");
  });

  it("退回 QUEUED 只认自己刚认领的那一行(条件式,踩不到跑完的行)", async () => {
    process.env.ASSET_UNDERSTANDING = "off";
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.where).toMatchObject({ id: "u-1", ownerId: OWNER, status: "RUNNING" });
  });
});

describe("平台日预算:超线本轮停,次日恢复", () => {
  const spend = (usd: number) => ({ _sum: { inputTokens: Math.round(usd / 1e-7), outputTokens: 0 } });

  it("今天已经花超预算 ⇒ 这一轮不派新活,一行都不建(行留在 QUEUED)", async () => {
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";
    mocks.assetUnderstanding.aggregate.mockResolvedValue(spend(1.5));
    mocks.asset.findMany.mockResolvedValue([{ id: "a-img", ownerId: OWNER, mime: "image/jpeg" }]);
    mocks.assetUnderstanding.findMany.mockResolvedValue([{ id: "u-stranded" }]);
    expect(await scanAssetsNeedingUnderstanding()).toEqual([]);
    expect(mocks.assetUnderstanding.create).not.toHaveBeenCalled();
    // 关键:一行都没有被写成终态 —— 超预算不动任何已有的行
    expect(mocks.assetUnderstanding.updateMany).not.toHaveBeenCalled();
  });

  it("预算以内照跑", async () => {
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";
    mocks.assetUnderstanding.aggregate.mockResolvedValue(spend(0.4));
    mocks.asset.findMany.mockResolvedValue([{ id: "a-img", ownerId: OWNER, mime: "image/jpeg" }]);
    expect(await scanAssetsNeedingUnderstanding()).toHaveLength(1);
  });

  it("次日自动恢复 —— 花费按 UTC 当天切,昨天的不算进今天", async () => {
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";
    const day2 = new Date("2026-08-14T02:00:00.000Z");
    mocks.assetUnderstanding.aggregate.mockResolvedValue(spend(0));
    mocks.asset.findMany.mockResolvedValue([{ id: "a-img", ownerId: OWNER, mime: "image/jpeg" }]);
    expect(await scanAssetsNeedingUnderstanding(day2)).toHaveLength(1);
    const where = mocks.assetUnderstanding.aggregate.mock.calls[0]![0].where;
    expect((where.updatedAt.gte as Date).toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("算的是**真实美元**,和 understandingCostUsd 同一条算式", async () => {
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";
    mocks.assetUnderstanding.aggregate.mockResolvedValue({
      _sum: { inputTokens: 3_000_000, outputTokens: 500_000 },
    });
    const spent = await understandingSpentTodayUsd();
    expect(spent).toBeCloseTo(understandingCostUsd({ inputTokens: 3_000_000, outputTokens: 500_000 }), 12);
    expect(spent).toBeCloseTo(0.5, 12); // 3M × $0.1/M + 0.5M × $0.4/M
    // 两列都 null(还没跑过任何一行)不炸
    mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: null, outputTokens: null } });
    expect(await understandingSpentTodayUsd()).toBe(0);
  });

  it("SUM 只读两列 token —— 数的是钱,不是行数", async () => {
    await understandingSpentTodayUsd();
    expect(mocks.assetUnderstanding.aggregate.mock.calls[0]![0]._sum).toEqual({
      inputTokens: true, outputTokens: true,
    });
    expect(mocks.assetUnderstanding.count).not.toHaveBeenCalled();
  });

  it("已经计费的失败也进账 —— 供应商回了 200 但产物读不出来的那一趟", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockResolvedValue({
      text: "I think it's a mug!", usage: { inputTokens: 2_000, outputTokens: 30 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("FAILED");
    // 钱花了就必须记账,否则日预算对这一整类失败是瞎的
    expect(last.data.inputTokens).toBe(2_000);
    expect(last.data.outputTokens).toBe(30);
  });
});

describe("image-caption", () => {
  it("落 DONE + 商家读得到的一句 + 结构化产物 + 用量记账", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    const done = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(done.data.status).toBe("DONE");
    expect(done.data.summary).toBe("A ceramic mug");
    expect(done.data.data).toMatchObject({ category: "homeware", isDocument: false });
    expect(done.data.inputTokens).toBe(900);
    expect(done.data.outputTokens).toBe(60);
  });

  it("看起来是一整页字 ⇒ 建 doc-extract 那一行,并把它的 id 交回去立刻排队(三件套之间那条线)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A printed menu", isDocument: true }),
      usage: { inputTokens: 800, outputTokens: 40 },
    });
    const followUp = await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.assetUnderstanding.create).toHaveBeenCalledTimes(1);
    const created = mocks.assetUnderstanding.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ ownerId: OWNER, assetId: ASSET, kind: "doc-extract", status: "QUEUED" });
    // 商家不该为一张菜单等十分钟 —— id 回给调用方,由它当场发进队列
    expect(followUp).toBe(created.id);
  });

  it("已经有 doc-extract 行(重投/并发)⇒ 不返回第二条,也不重复读", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.assetUnderstanding.create.mockRejectedValue(new Error("unique violation"));
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A printed menu", isDocument: true }),
      usage: { inputTokens: 800, outputTokens: 40 },
    });
    expect(await handleUnderstand({ understandingId: "u-1" }, 0, port)).toBeNull();
  });

  it("普通产品照**不**触发第二次花费", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    expect(await handleUnderstand({ understandingId: "u-1" }, 0, port)).toBeNull();
    expect(mocks.assetUnderstanding.create).not.toHaveBeenCalled();
  });

  it("产物解析不出来 ⇒ FAILED,不落半句空理解", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockResolvedValue({ text: "I think it's a mug!", usage: { inputTokens: 1, outputTokens: 1 } });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("FAILED");
    expect(mocks.assetUnderstanding.create).not.toHaveBeenCalled();
  });
});

describe("doc-extract(beta:必须有解析失败兜底)", () => {
  beforeEach(() => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("doc-extract"));
  });

  it("读出来的产品行落进 BrandRecord,来源标 otto", async () => {
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ products: [{ name: "Nasi Lemak", price: "RM 8.50", category: "mains" }] }),
      usage: { inputTokens: 3000, outputTokens: 300 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.brandRecord.create).toHaveBeenCalledTimes(1);
    const created = mocks.brandRecord.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ ownerId: OWNER, kind: "product", nameKey: "nasi lemak", source: "otto" });
    expect(created.data).toMatchObject({ name: "Nasi Lemak", price: "RM 8.50" });
  });

  it("同名产品**合并**,不再造一份(同一张菜单读第二次也一样)", async () => {
    mocks.brandRecord.findFirst.mockResolvedValue({ id: "br-1", data: { name: "Nasi Lemak", sellingAngle: "our best" } });
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ products: [{ name: "Nasi Lemak", price: "RM 8.50" }] }),
      usage: { inputTokens: 3000, outputTokens: 300 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.brandRecord.create).not.toHaveBeenCalled();
    expect(mocks.brandRecord.update).toHaveBeenCalledTimes(1);
    // 商家自己写过的字段保住了
    expect(mocks.brandRecord.update.mock.calls[0]![0].data.data).toMatchObject({
      name: "Nasi Lemak", price: "RM 8.50", sellingAngle: "our best",
    });
  });

  it("**解析失败兜底**:读不出来 ⇒ 一行 BrandRecord 都不写", async () => {
    mocks.understand.mockResolvedValue({ text: "Sorry, the photo is too blurry.", usage: { inputTokens: 3000, outputTokens: 20 } });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.brandRecord.create).not.toHaveBeenCalled();
    expect(mocks.brandRecord.update).not.toHaveBeenCalled();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("FAILED");
    expect(String(last.data.error)).toMatch(/couldn't be read/i);
  });

  it("空清单是合法结果(读不出来就不猜)—— DONE,零产品行", async () => {
    mocks.understand.mockResolvedValue({ text: JSON.stringify({ products: [] }), usage: { inputTokens: 3000, outputTokens: 10 } });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.brandRecord.create).not.toHaveBeenCalled();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("DONE");
    expect(String(last.data.summary)).toMatch(/no readable items/i);
  });

  it("无名/形状坏的行被丢掉,好的照落 —— 不因为一行坏而全废", async () => {
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ products: [{ price: "RM 5" }, { name: "Teh Tarik", price: "RM 3" }] }),
      usage: { inputTokens: 3000, outputTokens: 100 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.brandRecord.create).toHaveBeenCalledTimes(1);
    expect(mocks.brandRecord.create.mock.calls[0]![0].data.nameKey).toBe("teh tarik");
  });
});

describe("video-qa → 品牌记忆", () => {
  beforeEach(() => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("video-qa"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "mp4", mime: "video/mp4", durationS: 12, deletedAt: null,
    });
  });

  it("读出来的事实自动补进品牌记忆(票面原话)", async () => {
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A small corner cafe.", facts: ["Counter seating for eight.", "Open kitchen."] }),
      usage: { inputTokens: 9000, outputTokens: 200 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.memory.create).toHaveBeenCalledTimes(2);
    expect(mocks.memory.create.mock.calls[0]![0].data).toMatchObject({
      ownerId: OWNER, category: "about", source: "otto",
    });
  });

  it("商家自己已经写过的同一句话不再写第二遍", async () => {
    mocks.memory.findFirst.mockResolvedValue({ id: "m-1" });
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A small corner cafe.", facts: ["Counter seating for eight."] }),
      usage: { inputTokens: 9000, outputTokens: 200 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.memory.create).not.toHaveBeenCalled();
  });
});

describe("失败分类", () => {
  it("读不了这份字节 ⇒ 终止 FAILED,不抛(不占重试预算)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockRejectedValue(unreadableMediaError("rejected the file (415)"));
    await expect(handleUnderstand({ understandingId: "u-1" }, 0, port)).resolves.toBeNull();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("FAILED");
  });

  it("暂时性失败 + 还有重试额度 ⇒ 退回 QUEUED 并抛(让队列重投)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockRejectedValue(new Error("understanding request failed (503)"));
    await expect(handleUnderstand({ understandingId: "u-1" }, 0, port)).rejects.toThrow();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("QUEUED");
  });

  it("重试额度用完 ⇒ 落 FAILED,不再抛", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockRejectedValue(new Error("understanding request failed (503)"));
    await expect(handleUnderstand({ understandingId: "u-1" }, 2, port)).resolves.toBeNull();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("FAILED");
  });

  it("落库的失败措辞里没有 presigned URL、没有供应商名", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockRejectedValue(new Error("seedream failed reading https://r2.example/obj?sig=SECRET"));
    await expect(handleUnderstand({ understandingId: "u-1" }, 2, port)).resolves.toBeNull();
    const persisted = String(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.error).toLowerCase();
    expect(persisted).not.toContain("seedream");
    expect(persisted).not.toContain("sig=secret");
    expect(persisted).not.toContain("https://");
  });
});

describe("租户", () => {
  it("每一次落盘都带 ownerId", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("doc-extract"));
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ products: [{ name: "Kopi O" }] }),
      usage: { inputTokens: 100, outputTokens: 10 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    for (const call of mocks.assetUnderstanding.updateMany.mock.calls) {
      expect(call[0].where.ownerId).toBe(OWNER);
    }
    expect(mocks.asset.findFirst.mock.calls[0]![0].where.ownerId).toBe(OWNER);
    expect(mocks.brandRecord.findFirst.mock.calls[0]![0].where.ownerId).toBe(OWNER);
    expect(mocks.brandRecord.create.mock.calls[0]![0].data.ownerId).toBe(OWNER);
  });

  it("presign 用的是这一行自己的租户目录", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(String(mocks.presignedGet.mock.calls[0]![0])).toContain(OWNER);
  });
});

describe("扫描器:唯一的生产者", () => {
  it("图片建 caption 行,视频建 video-qa 行", async () => {
    mocks.asset.findMany.mockResolvedValue([
      { id: "a-img", ownerId: OWNER, mime: "image/jpeg" },
      { id: "a-vid", ownerId: OWNER, mime: "video/mp4" },
    ]);
    const ids = await scanAssetsNeedingUnderstanding();
    expect(ids).toHaveLength(2);
    const kinds = mocks.assetUnderstanding.create.mock.calls.map((c) => c[0].data.kind);
    expect(kinds).toEqual(["image-caption", "video-qa"]);
  });

  it("音频等不认识的类型一件都不建 —— 不猜就是不花钱", async () => {
    mocks.asset.findMany.mockResolvedValue([{ id: "a-aud", ownerId: OWNER, mime: "audio/mpeg" }]);
    expect(await scanAssetsNeedingUnderstanding()).toEqual([]);
    expect(mocks.assetUnderstanding.create).not.toHaveBeenCalled();
  });

  it("建行撞唯一约束(另一个副本先认领)⇒ 不返回,不重复读", async () => {
    mocks.asset.findMany.mockResolvedValue([{ id: "a-img", ownerId: OWNER, mime: "image/jpeg" }]);
    mocks.assetUnderstanding.create.mockRejectedValue(new Error("unique violation"));
    expect(await scanAssetsNeedingUnderstanding()).toEqual([]);
  });

  it("只看商家自己传/导入的东西,不读我们自己生成的图", async () => {
    await scanAssetsNeedingUnderstanding();
    expect(mocks.asset.findMany.mock.calls[0]![0].where.source).toEqual({ in: ["UPLOAD", "IMPORT"] });
    expect(mocks.asset.findMany.mock.calls[0]![0].where.deletedAt).toBeNull();
  });

  it("每一轮有条数上限 —— 节奏闸,不是成本闸(「最终全部读到」由下面那组钉)", async () => {
    expect(mocks.asset.findMany.mock.calls.length).toBe(0);
    await scanAssetsNeedingUnderstanding();
    expect(mocks.asset.findMany.mock.calls[0]![0].take).toBeGreaterThan(0);
    expect(mocks.asset.findMany.mock.calls[0]![0].take).toBeLessThanOrEqual(50);
  });

  it("候选集在 where 里就只留图片和视频 —— 音频不许占着队头", async () => {
    await scanAssetsNeedingUnderstanding();
    expect(mocks.asset.findMany.mock.calls[0]![0].where.OR).toEqual([
      { mime: { startsWith: "image/" } },
      { mime: { startsWith: "video/" } },
    ]);
  });

  it("总开关关掉 ⇒ 这一轮一件不派,也一行不动", async () => {
    process.env.ASSET_UNDERSTANDING = "off";
    mocks.asset.findMany.mockResolvedValue([{ id: "a-img", ownerId: OWNER, mime: "image/jpeg" }]);
    expect(await scanAssetsNeedingUnderstanding()).toEqual([]);
    expect(mocks.asset.findMany).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.create).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany).not.toHaveBeenCalled();
  });

  it("躺着没被投递出去的 QUEUED 行会被重发(含 caption 刚建的 doc-extract 行)", async () => {
    mocks.assetUnderstanding.findMany.mockResolvedValue([{ id: "u-stranded" }]);
    expect(await scanAssetsNeedingUnderstanding()).toEqual(["u-stranded"]);
  });

  it("刚建出来的行不会在同一轮里被算两次", async () => {
    mocks.asset.findMany.mockResolvedValue([{ id: "a-img", ownerId: OWNER, mime: "image/jpeg" }]);
    mocks.assetUnderstanding.create.mockImplementation(async () => ({}));
    const ids = await scanAssetsNeedingUnderstanding();
    mocks.assetUnderstanding.findMany.mockResolvedValue([{ id: ids[0]! }]);
    // 第二轮:同一行既在「刚建」也在「躺着」里出现时只算一次
    mocks.asset.findMany.mockResolvedValue([]);
    expect(await scanAssetsNeedingUnderstanding()).toEqual([ids[0]]);
  });
});

describe("清道夫", () => {
  it("崩在半路的 RUNNING 行退回 QUEUED(不是判死)", async () => {
    mocks.assetUnderstanding.findMany.mockResolvedValue([{ id: "u-1", ownerId: OWNER }]);
    expect(await reapStaleUnderstanding()).toBe(1);
    const call = mocks.assetUnderstanding.updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: "u-1", ownerId: OWNER, status: "RUNNING" });
    expect(call.data.status).toBe("QUEUED");
    expectNoCreditCalls();
  });

  it("刚好在这一刻跑完的行不会被踩掉(条件式认领输了就跳过)", async () => {
    mocks.assetUnderstanding.findMany.mockResolvedValue([{ id: "u-1", ownerId: OWNER }]);
    mocks.assetUnderstanding.updateMany.mockResolvedValue({ count: 0 });
    expect(await reapStaleUnderstanding()).toBe(0);
  });
});

/**
 * 内存假库:把 prisma 那几个 mock 接到一个真的会记住状态的小仓库上。
 *
 * 存在的理由只有一条 —— 上面那些逐调用断言钉不住「最终会怎样」。一个把 1950 张图逐一写死的
 * 实现能让它们全绿。要钉住主张,只能推进多轮,然后看仓库里剩下什么。
 */
function makeStore() {
  type A = { id: string; ownerId: string; mime: string; createdAt: number };
  type U = { id: string; ownerId: string; assetId: string; kind: string; status: string };
  const assets: A[] = [];
  const rows: U[] = [];
  // 索引,不是花架子:两千张 × 八十轮的线性扫描会让这一组用例在整包并跑时超时。
  const rowById = new Map<string, U>();
  const claimedAssets = new Set<string>(); // `understandings: { none: {} }` 那一段
  const uniqueKeys = new Set<string>(); // (ownerId, assetId, kind)

  mocks.asset.findMany.mockImplementation(async (args: any) => {
    const prefixes: string[] = (args.where.OR ?? []).map((c: any) => c.mime.startsWith);
    const out: Array<{ id: string; ownerId: string; mime: string }> = [];
    // orderBy createdAt desc —— assets 按 createdAt 递增 push,所以倒着走就是它
    for (let i = assets.length - 1; i >= 0 && out.length < args.take; i--) {
      const a = assets[i]!;
      if (prefixes.length > 0 && !prefixes.some((pfx) => a.mime.startsWith(pfx))) continue;
      if (claimedAssets.has(a.id)) continue;
      out.push({ id: a.id, ownerId: a.ownerId, mime: a.mime });
    }
    return out;
  });
  mocks.assetUnderstanding.create.mockImplementation(async ({ data }: any) => {
    const key = `${data.ownerId}|${data.assetId}|${data.kind}`;
    if (uniqueKeys.has(key)) throw new Error("unique violation"); // 建行就是认领
    uniqueKeys.add(key);
    claimedAssets.add(data.assetId);
    const r: U = { ...data };
    rows.push(r);
    rowById.set(r.id, r);
    return data;
  });
  mocks.assetUnderstanding.findMany.mockImplementation(async (args: any) => {
    // 躺着没被投递出去的 QUEUED 行:这个假库里 send 从不失败,所以那个窗口条件永远不成立。
    if (args.where.status === "QUEUED") return [];
    return rows.filter((r) => r.status === args.where.status).map((r) => ({ id: r.id, ownerId: r.ownerId }));
  });
  mocks.assetUnderstanding.findUnique.mockImplementation(async ({ where }: any) => rowById.get(where.id) ?? null);
  mocks.assetUnderstanding.updateMany.mockImplementation(async ({ where, data }: any) => {
    const r = rowById.get(where.id);
    if (!r || r.ownerId !== where.ownerId) return { count: 0 };
    if (where.status && r.status !== where.status) return { count: 0 };
    r.status = data.status ?? r.status;
    return { count: 1 };
  });

  return { assets, rows };
}

/** 推进一轮:扫描 → 把扫到的每一行跑完(生产里是 pg-boss 送出去,这里直接调)。 */
async function tick(): Promise<number> {
  const ids = await scanAssetsNeedingUnderstanding();
  for (const id of ids) await handleUnderstand({ understandingId: id }, 0, port);
  return ids.length;
}

describe("一次导入两千张,最终一张都不会漏", () => {
  it("多轮推进之后,每一张图都有一行 DONE —— 零永久遗漏", async () => {
    const store = makeStore();
    for (let i = 0; i < 2_000; i++) {
      store.assets.push({ id: `a-${i}`, ownerId: OWNER, mime: "image/jpeg", createdAt: i });
    }

    // 2000 ÷ 25 = 80 轮。多跑几轮以证明它会自己停,而不是靠轮数刚好卡住。
    let rounds = 0;
    while (rounds < 200 && (await tick()) > 0) rounds++;

    expect(store.rows).toHaveLength(2_000);
    expect(store.rows.every((r) => r.status === "DONE")).toBe(true);
    // 一行终态都不许是 SKIPPED —— 那正是「静悄悄忘掉商家 2/3 的店」的形状
    expect(store.rows.some((r) => r.status === "SKIPPED")).toBe(false);
    expect(rounds).toBeGreaterThanOrEqual(80);
    expectNoCreditCalls();
  });

  it("总开关关一阵子 = 暂停不销毁:重开之后那批素材照样被读完", async () => {
    const store = makeStore();
    for (let i = 0; i < 30; i++) {
      store.assets.push({ id: `a-${i}`, ownerId: OWNER, mime: "image/jpeg", createdAt: i });
    }

    await tick(); // 第一轮:25 件读完
    expect(store.rows.filter((r) => r.status === "DONE")).toHaveLength(25);

    process.env.ASSET_UNDERSTANDING = "off"; // 运维排查故障,关掉一小时
    for (let i = 0; i < 5; i++) await tick();
    expect(store.rows).toHaveLength(25); // 关着的时候一行都没多建
    expect(store.rows.some((r) => r.status === "SKIPPED")).toBe(false); // 也一行都没写死

    delete process.env.ASSET_UNDERSTANDING; // 开关打开
    while (await tick()) {
      /* 跑到没活为止 */
    }
    expect(store.rows).toHaveLength(30);
    expect(store.rows.every((r) => r.status === "DONE")).toBe(true);
  });

  it("平台预算见底 = 今天不派新活,次日全部补上", async () => {
    const store = makeStore();
    for (let i = 0; i < 30; i++) {
      store.assets.push({ id: `a-${i}`, ownerId: OWNER, mime: "image/jpeg", createdAt: i });
    }
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";

    mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: 20_000_000, outputTokens: 0 } }); // $2
    for (let i = 0; i < 5; i++) await tick();
    expect(store.rows).toHaveLength(0); // 超预算:一行都不建,也一行都不写死

    mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } }); // 次日归零
    while (await tick()) {
      /* 跑到没活为止 */
    }
    expect(store.rows).toHaveLength(30);
    expect(store.rows.every((r) => r.status === "DONE")).toBe(true);
  });

  it("存储签不出 URL 那一轮不丢东西 —— 下一轮就补回来", async () => {
    const store = makeStore();
    store.assets.push({ id: "a-1", ownerId: OWNER, mime: "image/jpeg", createdAt: 1 });

    mocks.presignedGet.mockResolvedValueOnce(null); // 存储抖了一下
    await tick();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.status).toBe("QUEUED"); // 退回队列,不是判死

    // 下一轮:第 ① 段看不见它(素材上已经有行了),投递靠的是行 id 直接重跑
    await handleUnderstand({ understandingId: store.rows[0]!.id }, 0, port);
    expect(store.rows[0]!.status).toBe("DONE");
  });

  it("最新的 25 件全是配乐时,老照片照样排得上队(队头不被音频堵死)", async () => {
    const store = makeStore();
    store.assets.push({ id: "a-old-photo", ownerId: OWNER, mime: "image/jpeg", createdAt: 0 });
    for (let i = 0; i < 25; i++) {
      store.assets.push({ id: `a-audio-${i}`, ownerId: OWNER, mime: "audio/mpeg", createdAt: 100 + i });
    }

    await tick();
    expect(store.rows.map((r) => r.assetId)).toEqual(["a-old-photo"]);
    expect(store.rows[0]!.status).toBe("DONE");
  });
});
