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
    createMany: vi.fn(),
    deleteMany: vi.fn(),
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

  const prisma = {
    assetUnderstanding,
    asset,
    brandRecord,
    memory,
    // 交互式事务:把同一组 mock 当 tx 交回去。**不是**装饰 —— caption 落 DONE 与
    // doc-extract 建行必须在同一个事务里(见 understand.ts),而「它们真的都走了 tx」
    // 是下面那组崩溃形状用例断言的东西。
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };

  return {
    prisma,
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

import { emptyUnderstandingResponseError, unreadableMediaError } from "@fikirtive/generation";
import { understandingCostUsd } from "@fikirtive/core";
import {
  UNDERSTAND_SCAN_BATCH,
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
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.prisma));
  mocks.assetUnderstanding.updateMany.mockResolvedValue({ count: 1 }); // CAS 默认赢
  mocks.assetUnderstanding.count.mockResolvedValue(1);
  mocks.assetUnderstanding.create.mockResolvedValue({});
  mocks.assetUnderstanding.createMany.mockResolvedValue({ count: 1 });
  mocks.assetUnderstanding.deleteMany.mockResolvedValue({ count: 1 });
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
      durationS: null, width: 8064, height: 6048, sizeBytes: BigInt(120 * 1024 * 1024), deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.presignedGet).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
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

  it("闸门判的是**素材本身**,而且端口也拿得到那几列(belt 用的是同一组数)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand.mock.calls[0]![0].media).toMatchObject({ width: 1600, height: 1200 });
  });
});

describe("元数据还不知道 = 不放行,但也不判死(r2 的闸穿透)", () => {
  it("宽高还没探测出来的图片 ⇒ **暂缓**,一个请求都不发,而且不写终态", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg",
      // 这就是穿透的那一张:48.77 MP 的照片,而字节数远在 40 MiB 的旧兜底之内
      durationS: null, width: null, height: null, sizeBytes: BigInt(6 * 1024 * 1024), deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.presignedGet).not.toHaveBeenCalled();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("QUEUED"); // 暂缓:ingest 补上宽高之后照样读得到
    expect(last.data.status).not.toBe("SKIPPED");
    expectNoCreditCalls();
  });

  it("时长还没探测出来的视频 ⇒ 同样暂缓(null 曾被当成 0 秒 ⇒ 任意长度都过闸)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("video-qa"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "mp4", mime: "video/mp4",
      durationS: null, width: 1920, height: 1080, sizeBytes: BigInt(90_000_000), deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("QUEUED");
  });

  it("扫描器根本不捞元数据没齐的素材 —— 拦在建行之前,连空转都省了", async () => {
    await scanAssetsNeedingUnderstanding();
    expect(mocks.asset.findMany.mock.calls[0]![0].where.OR).toEqual([
      { mime: { startsWith: "image/" }, width: { not: null }, height: { not: null } },
      { mime: { startsWith: "video/" }, durationS: { not: null } },
    ]);
  });
});

describe("素材被删:不写终态,删行(不然重传也救不回来)", () => {
  const deletedAsset = {
    contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg",
    durationS: null, width: 1600, height: 1200, sizeBytes: BigInt(400_000), deletedAt: new Date(),
  };

  it("素材已被软删 ⇒ 行被**删掉**,一个终态都不写", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.asset.findFirst.mockResolvedValue(deletedAsset);
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.assetUnderstanding.deleteMany.mock.calls[0]![0].where).toMatchObject({
      id: "u-1", ownerId: OWNER,
    });
    // r2 在这里写 SKIPPED —— 那一行会永久占着唯一键,商家删掉再重传也读不到
    const terminal = mocks.assetUnderstanding.updateMany.mock.calls.filter(
      (c) => c[0].data.status === "SKIPPED" || c[0].data.status === "FAILED",
    );
    expect(terminal).toHaveLength(0);
  });

  it("素材行整个不见了也一样(在途 job 遇到墓碑被清)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.asset.findFirst.mockResolvedValue(null);
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.assetUnderstanding.deleteMany).toHaveBeenCalledTimes(1);
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

  it("**200 + 空正文**那一趟也记账 —— 用量随错误走出端口(否则可无限计费而账面为零)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockRejectedValue(emptyUnderstandingResponseError({ inputTokens: 2_100, outputTokens: 4 }));
    await expect(handleUnderstand({ understandingId: "u-1" }, 0, port)).resolves.toBeNull();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("FAILED");
    expect(last.data.inputTokens).toBe(2_100);
    expect(last.data.outputTokens).toBe(4);
  });

  it("真的没花钱的失败不会凭空长出用量", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockRejectedValue(unreadableMediaError("rejected the file (415)"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("FAILED");
    expect(last.data.inputTokens).toBeUndefined();
    expect(last.data.outputTokens).toBeUndefined();
  });
});

/**
 * 扫描器那道预算闸拦的是「还没派出去的活」。拦不住的是**已经排在队列里的那一批** ——
 * 预算在半路见底时,积压的消息会继续一条条消费掉,超支远不止一轮。
 */
describe("预算闸必须也在 handler 里(积压队列会绕过扫描器那一道)", () => {
  beforeEach(() => {
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
  });

  it("付费调用之前复查 —— 超了就 hold 回队列,供应商一次不调", async () => {
    mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: 20_000_000, outputTokens: 0 } }); // $2
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.presignedGet).not.toHaveBeenCalled(); // 连 URL 都不签
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("QUEUED"); // 暂缓,次日继续 —— 不是判死
    expect(last.data.status).not.toBe("SKIPPED");
    expectNoCreditCalls();
  });

  it("预算以内照跑", async () => {
    mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: 1_000_000, outputTokens: 0 } }); // $0.1
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).toHaveBeenCalledTimes(1);
  });

  it("积压的一整批:预算在第二件之后见底 ⇒ 后面的一件都不打供应商", async () => {
    // 扫描器只在**派活之前**查一次,所以这一批是它派完之后才超的线
    let spentTokens = 0;
    mocks.assetUnderstanding.aggregate.mockImplementation(async () => ({
      _sum: { inputTokens: spentTokens, outputTokens: 0 },
    }));
    mocks.understand.mockImplementation(async () => {
      spentTokens += 5_000_000; // 每趟 $0.5
      return {
        text: JSON.stringify({ summary: "A ceramic mug", isDocument: false }),
        usage: { inputTokens: 5_000_000, outputTokens: 0 },
      };
    });
    for (let i = 0; i < 6; i++) await handleUnderstand({ understandingId: "u-1" }, 0, port);
    // $1 的预算 ⇒ 前两趟跑掉($0 起、$0.5 时),第三趟起 SUM 已经是 $1.0 ⇒ 全部 hold
    expect(mocks.understand).toHaveBeenCalledTimes(2);
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
    expect(mocks.assetUnderstanding.createMany).toHaveBeenCalledTimes(1);
    const created = mocks.assetUnderstanding.createMany.mock.calls[0]![0].data[0];
    expect(created).toMatchObject({ ownerId: OWNER, assetId: ASSET, kind: "doc-extract", status: "QUEUED" });
    // 商家不该为一张菜单等十分钟 —— id 回给调用方,由它当场发进队列
    expect(followUp).toBe(created.id);
  });

  it("已经有 doc-extract 行(重投/并发)⇒ 不返回第二条,也不重复读", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    // ON CONFLICT DO NOTHING:唯一冲突不产生错误,只是没插进去
    mocks.assetUnderstanding.createMany.mockResolvedValue({ count: 0 });
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A printed menu", isDocument: true }),
      usage: { inputTokens: 800, outputTokens: 40 },
    });
    expect(await handleUnderstand({ understandingId: "u-1" }, 0, port)).toBeNull();
  });

  it("普通产品照**不**触发第二次花费", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    expect(await handleUnderstand({ understandingId: "u-1" }, 0, port)).toBeNull();
    expect(mocks.assetUnderstanding.createMany).not.toHaveBeenCalled();
  });

  it("产物解析不出来 ⇒ FAILED,不落半句空理解", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockResolvedValue({ text: "I think it's a mug!", usage: { inputTokens: 1, outputTokens: 1 } });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("FAILED");
    expect(mocks.assetUnderstanding.createMany).not.toHaveBeenCalled();
  });
});

/**
 * 菜单那两步的原子性。r2 是两次独立的写:先 caption DONE,再建 doc 行,中间被杀或者
 * 撞上一个普通 DB 错误 ⇒ **DONE caption + 零 doc 行**,而扫描器只找「完全没有理解行」
 * 的素材 —— 那张菜单于是永远不会被读成产品目录。
 */
describe("菜单两步必须原子(P0:中间断掉就永久丢一张菜单)", () => {
  /** 每一次写发生时,我们**在不在**事务回调里面 —— 回滚的边界就是这条线。 */
  let depth = 0;
  const writesInsideTx: string[] = [];
  const writesOutsideTx: string[] = [];

  function note(label: string) {
    (depth > 0 ? writesInsideTx : writesOutsideTx).push(label);
  }

  beforeEach(() => {
    depth = 0;
    writesInsideTx.length = 0;
    writesOutsideTx.length = 0;
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      depth++;
      try {
        return await fn(mocks.prisma);
      } finally {
        depth--;
      }
    });
    mocks.assetUnderstanding.updateMany.mockImplementation(async (args: any) => {
      if (args.data?.status === "DONE") note("caption DONE");
      return { count: 1 };
    });
    mocks.assetUnderstanding.createMany.mockImplementation(async () => {
      note("doc row");
      return { count: 1 };
    });
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A printed menu", isDocument: true }),
      usage: { inputTokens: 800, outputTokens: 40 },
    });
  });

  it("两次写都在**同一个**事务回调里面 —— 一次提交,不是两次独立的写", async () => {
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(writesInsideTx).toEqual(["caption DONE", "doc row"]);
    expect(writesOutsideTx).toEqual([]); // r2 两次都在外面
  });

  it("第二步撞上普通 DB 错误 ⇒ 整趟抛出去,而 caption 那次 DONE 写在会被回滚的事务里", async () => {
    // 普通 DB 错误(不是唯一冲突):连接断、磁盘满、外键违反
    mocks.assetUnderstanding.createMany.mockImplementation(async () => {
      throw new Error("connection terminated unexpectedly");
    });
    await expect(handleUnderstand({ understandingId: "u-1" }, 0, port)).rejects.toThrow(/connection terminated/);
    // 承重的是「它写在事务里面」:r2 把 DONE 写在外面并**吞掉**第二步的错误,于是这一行
    // 留在库里,而 CAS 只认 QUEUED —— 那张菜单永久停在「有 caption、没有产品行」。
    expect(writesInsideTx).toEqual(["caption DONE"]);
    expect(writesOutsideTx).toEqual([]);
  });

  it("唯一冲突**不**是错误(ON CONFLICT DO NOTHING),而不是靠一个吞掉一切的 catch", async () => {
    mocks.assetUnderstanding.createMany.mockImplementation(async () => {
      note("doc row");
      return { count: 0 }; // 已经有了
    });
    await expect(handleUnderstand({ understandingId: "u-1" }, 0, port)).resolves.toBeNull();
    expect(mocks.assetUnderstanding.createMany.mock.calls[0]![0].skipDuplicates).toBe(true);
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

  it("每一轮**真的**只派得出 UNDERSTAND_SCAN_BATCH 件 —— 断言的是派出去的条数", async () => {
    // 假库一次给 200 件候选:上一版只断言 take ≤ 50,而 take 是一个**请求**,
    // 一个把 take 传对却返回 200 个 id 的实现照样绿。
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `a-${i}`, ownerId: OWNER, mime: "image/jpeg" }));
    mocks.asset.findMany.mockImplementation(async (args: any) => many.slice(0, args.take));
    const ids = await scanAssetsNeedingUnderstanding();
    expect(ids).toHaveLength(UNDERSTAND_SCAN_BATCH);
    expect(mocks.assetUnderstanding.create).toHaveBeenCalledTimes(UNDERSTAND_SCAN_BATCH);
    expect(mocks.asset.findMany.mock.calls[0]![0].take).toBe(UNDERSTAND_SCAN_BATCH);
  });

  it("第 ② 段也有同一条上限 —— 一轮派出去的总数不超过两个批次", async () => {
    mocks.asset.findMany.mockResolvedValue([]);
    const stranded = Array.from({ length: 200 }, (_, i) => ({ id: `u-${i}` }));
    mocks.assetUnderstanding.findMany.mockImplementation(async (args: any) => stranded.slice(0, args.take));
    const ids = await scanAssetsNeedingUnderstanding();
    expect(ids).toHaveLength(UNDERSTAND_SCAN_BATCH);
  });

  it("候选集在 where 里就只留图片和视频 —— 音频不许占着队头", async () => {
    await scanAssetsNeedingUnderstanding();
    const or = mocks.asset.findMany.mock.calls[0]![0].where.OR;
    expect(or.map((b: any) => b.mime)).toEqual([{ startsWith: "image/" }, { startsWith: "video/" }]);
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
  type A = {
    id: string;
    ownerId: string;
    mime: string;
    createdAt: number;
    width: number | null;
    height: number | null;
    durationS: number | null;
    deletedAt: Date | null;
  };
  type U = {
    id: string;
    ownerId: string;
    assetId: string;
    kind: string;
    status: string;
    createdAt: Date;
  };
  const assets: A[] = [];
  const rows: U[] = [];
  // 索引,不是花架子:两千张 × 八十轮的线性扫描会让这一组用例在整包并跑时超时。
  const rowById = new Map<string, U>();
  const assetById = new Map<string, A>();
  const rowsByAsset = new Map<string, Set<string>>(); // `understandings: { none: {} }` 那一段
  const uniqueKeys = new Map<string, string>(); // (ownerId, assetId, kind) → row id
  // 一件素材的**理解行创建时刻**往回推,好让扫描器第 ② 段(重投窗口)真的看得见它们:
  // 上一版让那一段永远返回空数组,于是「下一轮」在测试里根本不存在,只能靠直接调 handler
  // 假装。假装出来的下一轮证明不了下一轮真的会来。
  let clock = new Date("2026-08-13T00:00:00.000Z").getTime();
  const OLD_ENOUGH_MS = 11 * 60_000; // > UNDERSTAND_REDISPATCH_MIN_AGE_MS

  function addAsset(over: Partial<A> & { id: string }): void {
    const a: A = {
      ownerId: OWNER,
      mime: "image/jpeg",
      createdAt: assets.length,
      width: 1600,
      height: 1200,
      durationS: null,
      deletedAt: null,
      ...over,
    };
    assets.push(a);
    assetById.set(a.id, a);
  }

  /** 软删 / 重传复活 —— upload 那一侧的 upsert 就是把 deletedAt 清掉(同一行素材)。 */
  function softDelete(id: string): void {
    assetById.get(id)!.deletedAt = new Date();
  }
  function reupload(id: string): void {
    assetById.get(id)!.deletedAt = null;
  }

  mocks.asset.findMany.mockImplementation(async (args: any) => {
    const branches: any[] = args.where.OR ?? [];
    const out: Array<{ id: string; ownerId: string; mime: string }> = [];
    // orderBy createdAt desc —— assets 按 createdAt 递增 push,所以倒着走就是它
    for (let i = assets.length - 1; i >= 0 && out.length < args.take; i--) {
      const a = assets[i]!;
      if (a.deletedAt !== null) continue; // where.deletedAt: null
      // 每个 OR 分支是一个 AND:mime 前缀 + 该 kind 需要的元数据列非 null
      const matches = branches.some((b) => {
        if (!a.mime.startsWith(b.mime.startsWith)) return false;
        if (b.width && a.width === null) return false;
        if (b.height && a.height === null) return false;
        if (b.durationS && a.durationS === null) return false;
        return true;
      });
      if (!matches) continue;
      if ((rowsByAsset.get(a.id)?.size ?? 0) > 0) continue;
      out.push({ id: a.id, ownerId: a.ownerId, mime: a.mime });
    }
    return out;
  });
  mocks.asset.findFirst.mockImplementation(async ({ where }: any) => {
    const a = assetById.get(where.id);
    if (!a || a.ownerId !== where.ownerId) return null;
    return {
      contentHash: "a1".repeat(32),
      ext: a.mime.startsWith("video/") ? "mp4" : "jpg",
      mime: a.mime,
      durationS: a.durationS,
      width: a.width,
      height: a.height,
      sizeBytes: BigInt(400_000),
      deletedAt: a.deletedAt,
    };
  });
  const insert = (data: any): boolean => {
    const key = `${data.ownerId}|${data.assetId}|${data.kind}`;
    if (uniqueKeys.has(key)) return false; // 建行就是认领
    uniqueKeys.set(key, data.id);
    const set = rowsByAsset.get(data.assetId) ?? new Set<string>();
    set.add(data.id);
    rowsByAsset.set(data.assetId, set);
    const r: U = { ...data, createdAt: new Date(clock) };
    rows.push(r);
    rowById.set(r.id, r);
    return true;
  };
  mocks.assetUnderstanding.create.mockImplementation(async ({ data }: any) => {
    if (!insert(data)) throw new Error("unique violation");
    return data;
  });
  mocks.assetUnderstanding.createMany.mockImplementation(async ({ data }: any) => {
    let count = 0;
    for (const d of data) if (insert(d)) count++; // skipDuplicates: 冲突不抛,只是没插进去
    return { count };
  });
  mocks.assetUnderstanding.deleteMany.mockImplementation(async ({ where }: any) => {
    const r = rowById.get(where.id);
    if (!r || r.ownerId !== where.ownerId) return { count: 0 };
    rowById.delete(r.id);
    rows.splice(rows.indexOf(r), 1);
    uniqueKeys.delete(`${r.ownerId}|${r.assetId}|${r.kind}`);
    rowsByAsset.get(r.assetId)?.delete(r.id);
    return { count: 1 };
  });
  mocks.assetUnderstanding.findMany.mockImplementation(async (args: any) => {
    const w = args.where;
    // 第 ② 段:躺着没被投递出去的 QUEUED 行。**真的实现它** —— 「下一轮会补回来」这句话
    // 只有在下一轮真的由扫描器产生时才被证明。
    if (w.status === "QUEUED" && w.createdAt?.lt) {
      const cutoff = (w.createdAt.lt as Date).getTime();
      return rows
        .filter((r) => r.status === "QUEUED" && r.createdAt.getTime() < cutoff)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, args.take)
        .map((r) => ({ id: r.id, ownerId: r.ownerId }));
    }
    return rows.filter((r) => r.status === w.status).map((r) => ({ id: r.id, ownerId: r.ownerId }));
  });
  mocks.assetUnderstanding.findUnique.mockImplementation(async ({ where }: any) => rowById.get(where.id) ?? null);
  mocks.assetUnderstanding.updateMany.mockImplementation(async ({ where, data }: any) => {
    const r = rowById.get(where.id);
    if (!r || r.ownerId !== where.ownerId) return { count: 0 };
    if (where.status && r.status !== where.status) return { count: 0 };
    r.status = data.status ?? r.status;
    return { count: 1 };
  });

  /** 时间往前走一步,让上一轮建的 QUEUED 行越过重投窗口。 */
  const advancePastRedispatchWindow = () => {
    clock += OLD_ENOUGH_MS;
  };
  const now = () => new Date(clock);

  return { assets, rows, addAsset, softDelete, reupload, advancePastRedispatchWindow, now };
}

/**
 * 推进一轮:**只走扫描器** —— 它派什么就跑什么。
 *
 * 上一版有两处让「最终一张都不会漏」变得不可证:一处直接调 handler 冒充下一轮,
 * 一处让第 ② 段永远返回空。现在两处都由真的扫描器产生,所以「下一轮会补回来」这句话
 * 是被跑出来的,不是被安排出来的。
 */
async function tick(store: ReturnType<typeof makeStore>): Promise<number> {
  store.advancePastRedispatchWindow();
  const ids = await scanAssetsNeedingUnderstanding(store.now());
  for (const id of ids) await handleUnderstand({ understandingId: id }, 0, port);
  return ids.length;
}

/**
 * 一轮的活按**生产里的真实并发**跑(`WAIT_DEFAULTS[UNDERSTAND_QUEUE]` = 2,而扫描器
 * 一次派 25 件)。
 *
 * 为什么必须有这一条:串行的 `tick` 让「每件之间都重新查一次 SUM」看起来是免费的精确,
 * 而并发下 N 个 handler 会读到**同一个**还没被这一轮花费更新过的 SUM。所以这道闸的真实
 * 保证不是「一分不超」,而是「超出量被并发数封住」——串行测试永远看不见这个区别,
 * 也就永远不会在有人把并发从 2 调到 20 的那天变红。
 */
const UNDERSTAND_PRODUCTION_CONCURRENCY = 2;

async function tickConcurrent(
  store: ReturnType<typeof makeStore>,
  concurrency = UNDERSTAND_PRODUCTION_CONCURRENCY,
): Promise<number> {
  store.advancePastRedispatchWindow();
  const ids = await scanAssetsNeedingUnderstanding(store.now());
  const queue = [...ids];
  const lanes = Array.from({ length: concurrency }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      await handleUnderstand({ understandingId: id }, 0, port);
    }
  });
  await Promise.all(lanes);
  return ids.length;
}

describe("一次导入两千张,最终一张都不会漏", () => {
  it("多轮推进之后,每一张图都有一行 DONE —— 零永久遗漏", async () => {
    const store = makeStore();
    for (let i = 0; i < 2_000; i++) store.addAsset({ id: `a-${i}` });

    // 2000 ÷ 25 = 80 轮。多跑几轮以证明它会自己停,而不是靠轮数刚好卡住。
    let rounds = 0;
    while (rounds < 200 && (await tick(store)) > 0) rounds++;

    expect(store.rows).toHaveLength(2_000);
    expect(store.rows.every((r) => r.status === "DONE")).toBe(true);
    // 一行终态都不许是 SKIPPED —— 那正是「静悄悄忘掉商家 2/3 的店」的形状
    expect(store.rows.some((r) => r.status === "SKIPPED")).toBe(false);
    expect(rounds).toBeGreaterThanOrEqual(80);
    expectNoCreditCalls();
  });

  it("总开关关一阵子 = 暂停不销毁:重开之后那批素材照样被读完", async () => {
    const store = makeStore();
    for (let i = 0; i < 30; i++) store.addAsset({ id: `a-${i}` });

    await tick(store); // 第一轮:25 件读完
    expect(store.rows.filter((r) => r.status === "DONE")).toHaveLength(25);

    process.env.ASSET_UNDERSTANDING = "off"; // 运维排查故障,关掉一小时
    for (let i = 0; i < 5; i++) await tick(store);
    expect(store.rows).toHaveLength(25); // 关着的时候一行都没多建
    expect(store.rows.some((r) => r.status === "SKIPPED")).toBe(false); // 也一行都没写死

    delete process.env.ASSET_UNDERSTANDING; // 开关打开
    while (await tick(store)) {
      /* 跑到没活为止 */
    }
    expect(store.rows).toHaveLength(30);
    expect(store.rows.every((r) => r.status === "DONE")).toBe(true);
  });

  it("平台预算见底 = 今天不派新活,次日全部补上", async () => {
    const store = makeStore();
    for (let i = 0; i < 30; i++) store.addAsset({ id: `a-${i}` });
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";

    mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: 20_000_000, outputTokens: 0 } }); // $2
    for (let i = 0; i < 5; i++) await tick(store);
    expect(store.rows).toHaveLength(0); // 超预算:一行都不建,也一行都不写死

    mocks.assetUnderstanding.aggregate.mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } }); // 次日归零
    while (await tick(store)) {
      /* 跑到没活为止 */
    }
    expect(store.rows).toHaveLength(30);
    expect(store.rows.every((r) => r.status === "DONE")).toBe(true);
  });

  it("预算在**一轮的半路**见底 ⇒ 这一批剩下的全部暂缓(r2 会把 25 件全打出去)", async () => {
    const store = makeStore();
    for (let i = 0; i < 25; i++) store.addAsset({ id: `a-${i}` });
    process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = "1";

    // 扫描器派活那一刻 SUM 还是 $0(所以它这一轮不拦);每一趟真的花掉 $0.5。
    let spentTokens = 0;
    mocks.assetUnderstanding.aggregate.mockImplementation(async () => ({
      _sum: { inputTokens: spentTokens, outputTokens: 0 },
    }));
    mocks.understand.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0)); // 真的并发:让另一条 lane 挤进来
      spentTokens += 5_000_000; // $0.5
      return {
        text: JSON.stringify({ summary: "A ceramic mug", isDocument: false }),
        usage: { inputTokens: 5_000_000, outputTokens: 0 },
      };
    });

    expect(await tickConcurrent(store)).toBe(25); // 25 件全被派出去了

    // 这道闸能保证的**准确形状**(而不是「一分不超」):$1 的预算装得下 2 趟 $0.5,
    // 而并发下最多有 concurrency−1 条 lane 会读到同一个还没更新的 SUM 并跟着跑一趟。
    // 所以上界是 affordable + concurrency − 1,超出量被并发数封住,不被积压量封住。
    // r2 没有这道复查:25 件一件不落全部打出去,超支 12 倍 —— 而且下一轮还会接着来。
    const affordable = 2;
    const paid = mocks.understand.mock.calls.length;
    expect(paid).toBeGreaterThanOrEqual(affordable); // 也不许提前停(预算内的活要干完)
    expect(paid).toBeLessThanOrEqual(affordable + UNDERSTAND_PRODUCTION_CONCURRENCY - 1);
    // 停下来的那些是**暂缓**,不是判死
    expect(store.rows.filter((r) => r.status === "QUEUED")).toHaveLength(25 - paid);
    expect(store.rows.some((r) => r.status === "SKIPPED")).toBe(false);

    // 次日归零 ⇒ 剩下的全部补上,一件不漏
    spentTokens = 0;
    mocks.assetUnderstanding.aggregate.mockImplementation(async () => ({ _sum: { inputTokens: 0, outputTokens: 0 } }));
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A ceramic mug", isDocument: false }),
      usage: { inputTokens: 900, outputTokens: 60 },
    });
    while (await tick(store)) {
      /* 跑到没活为止 */
    }
    expect(store.rows).toHaveLength(25);
    expect(store.rows.every((r) => r.status === "DONE")).toBe(true);
  });

  it("存储签不出 URL 那一轮不丢东西 —— **下一轮扫描器自己**就补回来", async () => {
    const store = makeStore();
    store.addAsset({ id: "a-1" });

    mocks.presignedGet.mockResolvedValueOnce(null); // 存储抖了一下
    await tick(store);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.status).toBe("QUEUED"); // 退回队列,不是判死

    // 下一轮**照常走扫描器**:第 ① 段看不见它(素材上已经有行了),第 ② 段的重投窗口
    // 才是兜住它的那一段。上一版在这里直接调 handler —— 那证明不了下一轮真的会来。
    expect(await tick(store)).toBe(1);
    expect(store.rows[0]!.status).toBe("DONE");
  });

  it("最新的 25 件全是配乐时,老照片照样排得上队(队头不被音频堵死)", async () => {
    const store = makeStore();
    store.addAsset({ id: "a-old-photo" });
    for (let i = 0; i < 25; i++) store.addAsset({ id: `a-audio-${i}`, mime: "audio/mpeg" });

    await tick(store);
    expect(store.rows.map((r) => r.assetId)).toEqual(["a-old-photo"]);
    expect(store.rows[0]!.status).toBe("DONE");
  });

  it("元数据还没补齐的素材不占位:ingest 探测完之后的那一轮就读到了", async () => {
    const store = makeStore();
    store.addAsset({ id: "a-unprobed", width: null, height: null });

    expect(await tick(store)).toBe(0); // 这一轮根本不捞它
    expect(store.rows).toHaveLength(0); // 一行都没建,更没写死

    // ingest 的 ffprobe 跑完,宽高补上
    store.assets[0]!.width = 4032;
    store.assets[0]!.height = 3024;
    expect(await tick(store)).toBe(1);
    expect(store.rows[0]!.status).toBe("DONE");
  });

  it("**删掉再重传的素材照样读得到**(r2 在这里永久失忆)", async () => {
    const store = makeStore();
    store.addAsset({ id: "a-menu" });

    // 扫描器建了行、派了活,而商家在 handler 跑之前把它删了
    store.advancePastRedispatchWindow();
    const [id] = await scanAssetsNeedingUnderstanding(store.now());
    store.softDelete("a-menu");
    await handleUnderstand({ understandingId: id! }, 0, port);
    // r2 在这里落一行 SKIPPED,而那一行会永久占着 (ownerId, assetId, kind)
    expect(store.rows).toHaveLength(0);

    // 商家重传同一张图 —— upload 的 upsert 把 deletedAt 清掉,复活的是同一个 Asset
    store.reupload("a-menu");
    expect(await tick(store)).toBe(1); // **本轮就被扫到**
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.status).toBe("DONE");
  });
});
