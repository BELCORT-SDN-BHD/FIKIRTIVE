/**
 * understand.test.ts — #784 素材理解的后台执行器。
 *
 * 断言的都是这条链路上会真的出事的地方:
 *  - **商家一分钱不付**:reserveCredits / settleCredits / refundReservation / withLlmBudget
 *    一次都不许被调用(spy 全程盯着)。
 *  - **不重复读**:重投时 CAS 输掉 ⇒ 连供应商都不打。
 *  - **闸门在花钱之前**:总开关关、日额满、视频太长 —— 三种情况下 provider 一次都不调。
 *  - **解析失败兜底**(票面明写):doc-extract 读不出来 ⇒ 一行 BrandRecord 都不写。
 *  - **租户**:每一次读写都带 ownerId。
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
import {
  handleUnderstand,
  scanAssetsNeedingUnderstanding,
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
  delete process.env.ASSET_UNDERSTANDING_DAILY_CAP;
  mocks.assetUnderstanding.updateMany.mockResolvedValue({ count: 1 }); // CAS 默认赢
  mocks.assetUnderstanding.count.mockResolvedValue(1);
  mocks.assetUnderstanding.create.mockResolvedValue({});
  mocks.assetUnderstanding.findMany.mockResolvedValue([]);
  mocks.asset.findFirst.mockResolvedValue({
    contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg", durationS: null, deletedAt: null,
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
    await expect(handleUnderstand({ understandingId: "nope" }, 0, port)).resolves.toBeUndefined();
    expect(mocks.understand).not.toHaveBeenCalled();
  });
});

describe("闸门都在花钱之前", () => {
  it("总开关关掉 ⇒ SKIPPED,供应商一次不调", async () => {
    process.env.ASSET_UNDERSTANDING = "off";
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    const last = mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("SKIPPED");
    expectNoCreditCalls();
  });

  it("超过每日上限 ⇒ SKIPPED,供应商一次不调", async () => {
    process.env.ASSET_UNDERSTANDING_DAILY_CAP = "3";
    mocks.assetUnderstanding.count.mockResolvedValue(4); // 这一行已经算进 RUNNING 了
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
  });

  it("刚好到上限那一次还是要跑完(闸门不早关一格)", async () => {
    process.env.ASSET_UNDERSTANDING_DAILY_CAP = "3";
    mocks.assetUnderstanding.count.mockResolvedValue(3);
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).toHaveBeenCalledTimes(1);
  });

  it("日额只数真的花过的(RUNNING + DONE),SKIPPED/FAILED 不算", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.assetUnderstanding.count.mock.calls[0]![0].where.status).toEqual({ in: ["RUNNING", "DONE"] });
  });

  it("视频比理解预算覆盖得住的还长 ⇒ SKIPPED —— 这道闸是「1%」能成立的前提", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("video-qa"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "mp4", mime: "video/mp4", durationS: 600, deletedAt: null,
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
  });

  it("素材已被删 ⇒ SKIPPED", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.asset.findFirst.mockResolvedValue({
      contentHash: "a1".repeat(32), ext: "jpg", mime: "image/jpeg", durationS: null, deletedAt: new Date(),
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
  });

  it("签不出 URL(本地磁盘驱动)⇒ SKIPPED,不当成故障反复重试", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.presignedGet.mockResolvedValue(null);
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
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

  it("看起来是一整页字 ⇒ 建 doc-extract 那一行(三件套之间那条线)", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockResolvedValue({
      text: JSON.stringify({ summary: "A printed menu", isDocument: true }),
      usage: { inputTokens: 800, outputTokens: 40 },
    });
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
    expect(mocks.assetUnderstanding.create).toHaveBeenCalledTimes(1);
    expect(mocks.assetUnderstanding.create.mock.calls[0]![0].data).toMatchObject({
      ownerId: OWNER, assetId: ASSET, kind: "doc-extract", status: "QUEUED",
    });
  });

  it("普通产品照**不**触发第二次花费", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    await handleUnderstand({ understandingId: "u-1" }, 0, port);
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
    await expect(handleUnderstand({ understandingId: "u-1" }, 0, port)).resolves.toBeUndefined();
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
    await expect(handleUnderstand({ understandingId: "u-1" }, 2, port)).resolves.toBeUndefined();
    expect(mocks.assetUnderstanding.updateMany.mock.calls.at(-1)![0].data.status).toBe("FAILED");
  });

  it("落库的失败措辞里没有 presigned URL、没有供应商名", async () => {
    mocks.assetUnderstanding.findUnique.mockResolvedValue(row("image-caption"));
    mocks.understand.mockRejectedValue(new Error("seedream failed reading https://r2.example/obj?sig=SECRET"));
    await expect(handleUnderstand({ understandingId: "u-1" }, 2, port)).resolves.toBeUndefined();
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

  it("每一轮有条数上限 —— 一次导入两千张不会把额度一口气烧穿", async () => {
    expect(mocks.asset.findMany.mock.calls.length).toBe(0);
    await scanAssetsNeedingUnderstanding();
    expect(mocks.asset.findMany.mock.calls[0]![0].take).toBeGreaterThan(0);
    expect(mocks.asset.findMany.mock.calls[0]![0].take).toBeLessThanOrEqual(50);
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
