/**
 * refgen-receipt.test.ts —— #914 r6(判官 r5 P1-1):元素参考照这条**付费**产品线的
 * 「我们实际送出了哪一句」也要落库。
 *
 * 为什么必须有这个文件:r4 把回执接在 `gen.ts` 的两个发送点上,并声称「所有花钱入口都汇到
 * 那一个发送点,覆盖是结构性的」。判官 r5 当场指出这句话不成立 —— `refgen.ts` 是**第三个**
 * 生产 provider 调用点,而且它同样收费(generate-references 走 `reserveCredits` 预扣)。
 * 覆盖不能靠一句话,得靠这里的断言。
 *
 * 断言形状与 `gen-receipt.test.ts` 逐字同构,不另立标准:
 *
 *     落进 RefGenJob.sentPromptText 的字符串  ===  provider 这一次真正收到的 prompt
 *
 * 两边都取自**同一次真跑的 handleRefGen**(左边取 commit 那一笔 updateMany 的 data,右边取
 * provider 替身的入参),测试里没有一处照着实现重算期望值。另外钉两件事:它与
 * `outputAssetIds` / `spentUsd` 同在那**一笔**提交里(交付成立的那一刻记录才成立),以及
 * 花钱之前就失败的单不会留下这条记录(没送出过,就没有可记的)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => {
  const refGenJobFindUnique = vi.fn();
  const refGenJobUpdate = vi.fn();
  const refGenJobUpdateMany = vi.fn();
  const entityFindFirst = vi.fn();
  const entityUpdate = vi.fn();
  const assetUpsert = vi.fn();
  const referenceImageFindFirst = vi.fn();
  const referenceImageCreate = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generate = vi.fn();
  const storagePut = vi.fn();
  const storagePresignedGet = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refGenJob: { findUnique: refGenJobFindUnique, update: refGenJobUpdate, updateMany: refGenJobUpdateMany },
    entity: { findFirst: entityFindFirst, update: entityUpdate },
    entityVariant: { findFirst: vi.fn() },
    asset: { upsert: assetUpsert, findFirst: vi.fn() },
    referenceImage: { findFirst: referenceImageFindFirst, create: referenceImageCreate, findMany: vi.fn(async () => []) },
    creditLedger: { findFirst: vi.fn(async () => null) },
    // finalizeDone 传的是 PrismaPromise 数组;结算那一笔传的是回调
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma)),
  };
  return {
    prisma, refGenJobFindUnique, refGenJobUpdate, refGenJobUpdateMany, entityFindFirst, entityUpdate,
    assetUpsert, referenceImageFindFirst, referenceImageCreate, refundReservation, settleCredits,
    generate, storagePut, storagePresignedGet,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, Prisma: {} }));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "fal", generate: m.generate } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));

import { handleRefGen } from "./refgen.js";

const MERCHANT_PROMPT =
  "Professional reference portrait of Rosa, 30s Malaysian founder. Plain light-gray background.";

const job = {
  id: "rj1",
  ownerId: "o1",
  entityId: "e1",
  status: "QUEUED",
  mode: "BASE",
  model: "seedream",
  prompt: MERCHANT_PROMPT,
  count: 1,
  variantId: null,
  outputAssetIds: [] as string[],
  spentUsd: null,
};

let consoleLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  m.refGenJobFindUnique.mockResolvedValue(job);
  m.entityFindFirst.mockResolvedValue({ id: "e1", baseAssetId: null });
  m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
  m.refGenJobUpdate.mockResolvedValue({});
  m.entityUpdate.mockResolvedValue({});
  m.assetUpsert.mockResolvedValue({ id: "asset1" });
  m.referenceImageFindFirst.mockResolvedValue(null);
  m.referenceImageCreate.mockResolvedValue({});
  m.storagePut.mockResolvedValue({ contentHash: "a".repeat(64) });
  m.generate.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
});

afterEach(() => consoleLog.mockRestore());

/** 真跑一次 handleRefGen,把「引擎真正收到的那句」和「commit 那一笔写进去的东西」交回。 */
async function sentVsCommitted() {
  await handleRefGen({ refGenJobId: "rj1" }, 0);
  const call = m.generate.mock.calls[0]?.[0] as { prompt: string } | undefined;
  const commit = m.refGenJobUpdateMany.mock.calls
    .map((c) => c[0] as { data: Record<string, unknown> })
    .find((a) => "outputAssetIds" in a.data);
  return { sent: call?.prompt, commit: commit?.data };
}

describe("#914 r6 —— 元素参考照(第三个付费发送点)同样记录实际送出的那一句", () => {
  it("落库的就是 provider 真正收到的那个字符串", async () => {
    const { sent, commit } = await sentVsCommitted();
    expect(sent, "这条用例要有意义,付费调用必须真的发生过").toBeDefined();
    expect(commit, "交付成立时必须有 commit 那一笔").toBeDefined();
    expect(commit!.sentPromptText).toBe(sent);
    // 这条产品线上 worker 不拼装,所以它今天恒等于任务上那句 —— 钉住这个事实,
    // 将来谁在这里加了拼装(而忘了记录),上面那条断言会先红。
    expect(sent).toBe(MERCHANT_PROMPT);
  });

  it("与产出、与冻结的花费同在**一笔**提交里 —— 交付成立的那一刻记录才成立", async () => {
    const { commit } = await sentVsCommitted();
    expect(commit).toMatchObject({ outputAssetIds: ["asset1"] });
    expect(typeof commit!.spentUsd).toBe("number");
    expect(typeof commit!.sentPromptText).toBe("string");
  });

  it("记录不是钱:结算照旧一次,交付照旧完成", async () => {
    await sentVsCommitted();
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).not.toHaveBeenCalled();
    const done = m.refGenJobUpdate.mock.calls.map((c) => c[0] as { data: Record<string, unknown> });
    expect(done.some((u) => u.data.status === "DONE")).toBe(true);
  });

  it("花钱之前就失败的单(元素已被删)⇒ 一个字都不记 —— 没送出过就没有可记的", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    m.entityFindFirst.mockResolvedValue(null);
    await handleRefGen({ refGenJobId: "rj1" }, 0);
    expect(m.generate).not.toHaveBeenCalled();
    const writes = [
      ...m.refGenJobUpdateMany.mock.calls.map((c) => c[0] as { data: Record<string, unknown> }),
      ...m.refGenJobUpdate.mock.calls.map((c) => c[0] as { data: Record<string, unknown> }),
    ];
    expect(writes.every((w) => !("sentPromptText" in w.data))).toBe(true);
    consoleError.mockRestore();
  });
});
