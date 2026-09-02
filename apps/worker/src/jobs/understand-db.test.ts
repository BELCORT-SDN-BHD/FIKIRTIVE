/**
 * understand-db.test.ts — #784 素材理解,**打真库**的那几条。
 *
 * 为什么这一族必须跑真库(understand.test.ts 的假库钉不住它们):
 *
 *  1. **删掉再重传**。这条链路上最贵的一个缺陷不在某一个函数里,它在三样东西的**接缝**上:
 *     `AssetUnderstanding (ownerId, assetId, kind)` 那个唯一索引、`Asset (ownerId, contentHash)`
 *     的复用、以及扫描器 `understandings: { none: {} }` 那一段。假库里这三样都是我自己写的,
 *     我写对了它就绿 —— 而缺陷恰恰是「真实的唯一约束会一直挡在那里」。
 *  2. **`createMany({ skipDuplicates })` 真的是 ON CONFLICT DO NOTHING**,而不是一个
 *     mock 返回的 `{ count: 0 }`。菜单那两步的原子性整个压在这个语义上。
 *  3. **租户守卫真的在**:扫描器跨租户、逐行写入进 `runAsTenant`,而 `withTenantGuard` 是
 *     一个 Prisma extension —— mock 掉 `@fikirtive/db` 的那些用例连它都加载不到。
 *
 * 纪律照旧:**供应商全程 mock,一个字节都不出网**;每个用例自己建自己的租户、跑完自己收。
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const presignedGet = vi.hoisted(() => vi.fn(async () => "https://storage.example/obj?sig=x"));
vi.mock("../storage.js", () => ({ storage: { presignedGet } }));

import { prisma, refundReservation } from "@fikirtive/db";
import { UNDERSTANDING_CAPS, newId, pricedUnderstandingCredits, understandingCostUsd } from "@fikirtive/core";
import type { UnderstandingProvider } from "@fikirtive/generation";
import {
  handleUnderstand,
  reapStaleUnderstandingReservations,
  scanAssetsNeedingUnderstanding,
  recordUnderstandingBudget,
  understandingSpentTodayUsd,
} from "./understand.js";

// ── 安全闸(同 packages/db/test/setup.ts):非 *_test 库一律拒跑 ──────────────────
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error(
    "understand-db.test.ts hits a real database — set DATABASE_URL to a *_test database before running it.",
  );
}
const dbName = dbUrl.split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`understand-db.test.ts refuses a non-*_test database — got "${dbName}".`);
}

/** 离线端口。文件名带 menu 的当菜单 —— caption → doc-extract 那条线在真库上也走得通。 */
const port: UnderstandingProvider = {
  name: "mock",
  async understand(req) {
    const isMenu = /menu/i.test(req.mediaUrl);
    const body = isMenu
      ? { summary: "A printed menu", category: "menu", isDocument: true }
      : req.kind === "doc-extract"
        ? { products: [{ name: "Nasi Lemak", price: "RM 8.50" }] }
        : { summary: "A ceramic mug", category: "homeware", isDocument: false };
    return { text: JSON.stringify(body), usage: { inputTokens: 900, outputTokens: 60 } };
  },
};

const OWNER = `t784-${newId()}`;

/** 一件普通的、元数据齐全的商家上传照片。 */
async function seedAsset(over: Partial<{ mime: string; width: number | null; height: number | null; durationS: number | null }> = {}) {
  const id = newId();
  await prisma.asset.create({
    data: {
      id,
      ownerId: OWNER,
      contentHash: randomBytes(32).toString("hex"), // storageKey 只认 64 位小写 hex
      ext: "jpg",
      mime: "image/jpeg",
      sizeBytes: BigInt(400_000),
      originalFilename: "shopfront.jpg",
      source: "UPLOAD",
      width: 1600,
      height: 1200,
      durationS: null,
      ...over,
    },
  });
  return id;
}

/**
 * 测试自己的读写也得带 ownerId —— `withTenantGuard` 是一个真的 Prisma extension,
 * 没有租户帧的 `findUnique({ where: { id } })` 会被它当成越租户读直接拒掉。
 * (mock 掉 `@fikirtive/db` 的那些用例连这条约束都碰不到,这也是这个文件存在的理由之一。)
 */
async function myRows() {
  return prisma.assetUnderstanding.findMany({ where: { ownerId: OWNER }, orderBy: { createdAt: "asc" } });
}

async function myRow(id: string) {
  return prisma.assetUnderstanding.findFirst({ where: { id, ownerId: OWNER } });
}

/** 这个租户的余额账户(钱路那几条用例共用一个,所以是 upsert 不是 create)。 */
async function setBalance(balance: number, reserved = 0) {
  await prisma.creditAccount.upsert({
    where: { orgId: OWNER },
    create: { orgId: OWNER, balance, reserved },
    update: { balance, reserved },
  });
}

async function setAsset(assetId: string, data: Record<string, unknown>) {
  await prisma.asset.updateMany({ where: { id: assetId, ownerId: OWNER }, data: data as never });
}

/** 扫描器派出去的活里,属于这个租户的那些。 */
async function scanMine(now = new Date()): Promise<string[]> {
  const ids = await scanAssetsNeedingUnderstanding(now);
  if (ids.length === 0) return [];
  const mine = await prisma.assetUnderstanding.findMany({
    where: { ownerId: OWNER, id: { in: ids } },
    select: { id: true },
  });
  return mine.map((r) => r.id);
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: OWNER, name: "t784" } });
  // MONEY-A9:扫描器建行时就把快照价写死,所以这个文件里**每一件**被扫到的素材都是一笔真
  // 扣费。没有余额的租户会一路停在 PAUSED_BALANCE —— 那正是这些用例在 A9 接线之后集体变红
  // 的原因,而它们要钉的根本不是钱(钱由本文件末尾那几个 describe 自己设余额去钉)。
  // 给一笔够整份文件跑完的余额:一件 1 internal(现值),这里几十件。
  await setBalance(10_000);
});

afterAll(async () => {
  await prisma.assetUnderstanding.deleteMany({ where: { ownerId: OWNER } });
  await prisma.brandRecord.deleteMany({ where: { ownerId: OWNER } });
  await prisma.memory.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.creditAccount.deleteMany({ where: { orgId: OWNER } }); // FK:必须在 org 之前
  await prisma.organization.deleteMany({ where: { id: OWNER } });
});

describe("删掉再重传:商家唯一的自救路径必须真的通(真库)", () => {
  it(
    "删 → 重传 → **本轮被扫到** → DONE",
    async () => {
      const assetId = await seedAsset();

      // ① 扫描器认领它并派活
      const [understandingId] = await scanMine();
      expect(understandingId).toBeTruthy();

      // ② 商家在 handler 跑之前把它删了(素材库的软删)
      await setAsset(assetId, { deletedAt: new Date() });
      await handleUnderstand({ understandingId: understandingId! }, 0, port);

      // r2 在这里落一行 SKIPPED。真库上那一行会一直占着 (ownerId, assetId, kind) 唯一索引,
      // 而扫描器第 ① 段找的是「完全没有理解行」的素材 —— 于是重传也永远救不回来。
      expect(await myRows()).toHaveLength(0);

      // ③ 商家重传同一张图:upload 的 upsert 把 deletedAt 清掉,复活的是**同一个** Asset
      await setAsset(assetId, { deletedAt: null });

      // ④ 本轮就被扫到,并且读完
      const [again] = await scanMine();
      expect(again).toBeTruthy();
      await handleUnderstand({ understandingId: again! }, 0, port);

      const rows = await myRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("DONE");
      expect(rows[0]!.assetId).toBe(assetId);
    },
    30_000,
  );

  it(
    "真终局(这份字节读不动)仍然是 SKIPPED —— 重传同样的字节也一样读不动",
    async () => {
      await seedAsset({ width: 8064, height: 6048 }); // 48 MP
      const [id] = await scanMine();
      expect(id).toBeTruthy();
      await handleUnderstand({ understandingId: id! }, 0, port);
      const row = await myRow(id!);
      expect(row!.status).toBe("SKIPPED");
      expect(row!.error).toMatch(/larger than the reading budget/i);
    },
    30_000,
  );

  it(
    "元数据还没探测出来的素材**根本不进这一轮**(fail closed,而且不留终态)",
    async () => {
      const assetId = await seedAsset({ width: null, height: null });
      expect(await scanMine()).toEqual([]);
      expect(await prisma.assetUnderstanding.count({ where: { ownerId: OWNER, assetId } })).toBe(0);

      // ingest 的 ffprobe 补上宽高之后,下一轮正常读到
      await setAsset(assetId, { width: 4032, height: 3024 });
      const [id] = await scanMine();
      expect(id).toBeTruthy();
      await handleUnderstand({ understandingId: id! }, 0, port);
      const row = await myRow(id!);
      expect(row!.status).toBe("DONE");
    },
    30_000,
  );
});

describe("MONEY-A9:扫描器建行就锁价(真库上那两格真的落下去了)", () => {
  it(
    "新上传的图片 → 行上带本段价 + 级联价 → 跑完真的扣了那一笔(免费祖父一件都轮不上)",
    async () => {
      const assetId = await seedAsset();
      const [id] = await scanMine();
      expect(id).toBeTruthy();

      // ① 建行那一刻两格价就在库里(假库钉不住列真的存在、也钉不住写得进去)
      const fresh = await myRow(id!);
      expect(fresh!.priceInternalSnapshot).toBe(pricedUnderstandingCredits("image-caption"));
      expect(fresh!.cascadePriceInternal).toBe(pricedUnderstandingCredits("doc-extract"));

      // ② 跑完之后台账上真的有这一行的 RESERVE + SETTLE,金额就是那格快照价
      const before = await prisma.creditAccount.findUnique({ where: { orgId: OWNER } });
      await handleUnderstand({ understandingId: id! }, 0, port);
      expect((await myRow(id!))!.status).toBe("DONE");

      const refId = `understanding:${id}`;
      const ledger = await prisma.creditLedger.findMany({ where: { orgId: OWNER, refId } });
      expect(ledger.map((l) => l.kind).sort()).toEqual(["RESERVE", "SETTLE"]);
      // 余额真的少了那一格 —— 「收费链路接上了」最后只能由余额本身作证
      const after = await prisma.creditAccount.findUnique({ where: { orgId: OWNER } });
      expect(before!.balance - after!.balance).toBe(pricedUnderstandingCredits("image-caption"));
      expect(after!.reserved).toBe(before!.reserved); // hold 已结清,没漏在半路

      await prisma.assetUnderstanding.deleteMany({ where: { ownerId: OWNER, assetId } });
    },
    30_000,
  );

  it(
    "视频行没有级联价 —— 视频不会触发 doc-extract,填一格就是承诺一笔不会发生的扣费",
    async () => {
      const assetId = await seedAsset({ mime: "video/mp4", width: null, height: null, durationS: 12 });
      const [id] = await scanMine();
      const fresh = await myRow(id!);
      expect(fresh!.kind).toBe("video-qa");
      expect(fresh!.priceInternalSnapshot).toBe(pricedUnderstandingCredits("video-qa"));
      expect(fresh!.cascadePriceInternal).toBeNull();

      await prisma.assetUnderstanding.deleteMany({ where: { ownerId: OWNER, assetId } });
      await prisma.asset.deleteMany({ where: { id: assetId, ownerId: OWNER } });
    },
    30_000,
  );
});

describe("菜单两步在真库上的原子性与幂等", () => {
  it(
    "caption 判定是菜单 ⇒ 同一个事务里落 DONE + 建 doc 行,而重投不会建第二行",
    async () => {
      const assetId = await seedAsset({ mime: "image/jpeg" });
      presignedGet.mockResolvedValueOnce("https://storage.example/menu.jpg?sig=x");

      const [captionId] = await scanMine();
      const followUp = await handleUnderstand({ understandingId: captionId! }, 0, port);
      expect(followUp).toBeTruthy();

      const rows = await prisma.assetUnderstanding.findMany({ where: { ownerId: OWNER, assetId } });
      expect(rows.map((r) => r.kind).sort()).toEqual(["doc-extract", "image-caption"]);
      expect(rows.find((r) => r.kind === "image-caption")!.status).toBe("DONE");
      expect(rows.find((r) => r.kind === "doc-extract")!.status).toBe("QUEUED");

      // 真的 ON CONFLICT DO NOTHING:同一个 (ownerId, assetId, 'doc-extract') 再插一次
      // 既不抛错,也不产生第二行(菜单不会被读两次 ⇒ 产品目录不会凭空多一份)。
      const dup = await prisma.assetUnderstanding.createMany({
        data: [{ id: newId(), ownerId: OWNER, assetId, kind: "doc-extract", status: "QUEUED" }],
        skipDuplicates: true,
      });
      expect(dup.count).toBe(0);
      expect(await prisma.assetUnderstanding.count({ where: { ownerId: OWNER, assetId } })).toBe(2);

      // doc-extract 跑完 ⇒ 产品行落进 BrandRecord
      await handleUnderstand({ understandingId: followUp! }, 0, port);
      const products = await prisma.brandRecord.findMany({ where: { ownerId: OWNER, kind: "product" } });
      expect(products.map((p) => p.nameKey)).toContain("nasi lemak");
    },
    30_000,
  );
});

/**
 * 存量恢复(2026-08-18 事故):被误判成终态的行必须能回到队列。
 *
 * 为什么这一族也必须打真库,而且**执行迁移文件里那条语句本身**:恢复是一句 SQL,而这句
 * SQL 唯一会出事的地方是它的 WHERE —— 少一个条件就从「修好被误杀的行」变成「把真的
 * 读不了的文件重新排进队列,永远读不完」。假库钉不住 `LIKE`;把 SQL 重抄一份到测试里,
 * 钉住的也只是那份抄件。所以这里读的是迁移文件本体,跑的是它 RECOVERY 标记之间的原文。
 */
const RECOVERY_SQL = (() => {
  const path = fileURLToPath(
    new URL(
      "../../../../packages/db/prisma/migrations/20260818140000_understanding_paused_and_404_recovery/migration.sql",
      import.meta.url,
    ),
  );
  const sql = readFileSync(path, "utf8");
  const body = sql.split(">>> RECOVERY")[1]?.split("<<< RECOVERY")[0] ?? "";
  const statement = body.slice(body.indexOf("UPDATE")).split(";")[0]?.trim();
  if (!statement) throw new Error("recovery statement not found in the migration file");
  return statement;
})();

describe("存量 FAILED 行的恢复(直接跑迁移文件里的那条语句)", () => {
  /** 生产上那些行落的就是这一句 —— 端口逐字抛出、sanitizeError 原样放行、worker 落库。 */
  const SIGNATURE = "understanding request failed (404)";

  async function seedRow(status: string, error: string | null) {
    const assetId = await seedAsset();
    const id = newId();
    await prisma.assetUnderstanding.create({
      data: { id, ownerId: OWNER, assetId, kind: "image-caption", status, error },
    });
    return id;
  }

  it(
    "只清签名内的 FAILED 行,而且跑两遍结果一样",
    async () => {
      const killedByConfig = await seedRow("FAILED", SIGNATURE);
      const reallyUnreadable = await seedRow("FAILED", "That file couldn't be read clearly enough to use.");
      const skippedTooBig = await seedRow("SKIPPED", `left unread — ${SIGNATURE}`);
      const done = await seedRow("DONE", null);

      // 计数按 `>= 1` 断言而不是 `=== 1`:这条语句是**全表**的(签名跨租户,那正是它的
      // 设计),同一个测试库里别的套件也可能有行。真正的内容断言在下面,逐行、按 owner。
      expect(await prisma.$executeRawUnsafe(RECOVERY_SQL)).toBeGreaterThanOrEqual(1);

      const after = async (id: string) => (await myRow(id))!;
      const snapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            [killedByConfig, reallyUnreadable, skippedTooBig, done].map(async (id) => {
              const r = await after(id);
              return [id, `${r.status}|${r.error ?? ""}`] as const;
            }),
          ),
        );

      expect(await after(killedByConfig)).toMatchObject({ status: "QUEUED", error: null });
      // 越界清理的三个反例:真读不了的、别的终态、已经读懂的 —— 一行都不许被碰
      expect((await after(reallyUnreadable)).status).toBe("FAILED");
      expect((await after(skippedTooBig)).status).toBe("SKIPPED");
      expect((await after(done)).status).toBe("DONE");

      // 幂等:再跑一遍,我们这四行一个字都不变(status 和 error 已经一起改掉了,
      // 所以第二遍匹配不到它们)。比断言「第二遍影响 0 行」更稳,也更接近真正的主张。
      const before = await snapshot();
      await prisma.$executeRawUnsafe(RECOVERY_SQL);
      expect(await snapshot()).toEqual(before);
    },
    30_000,
  );

  it(
    "恢复出来的行**真的**会被扫描器重新派出去(不然「恢复」只是改了个字)",
    async () => {
      const id = await seedRow("FAILED", SIGNATURE);
      await prisma.$executeRawUnsafe(RECOVERY_SQL);
      // 第 ② 段捞的是躺够久的 QUEUED 行 —— 把 now 往后拨,等的就是那个窗口
      const dispatched = await scanAssetsNeedingUnderstanding(new Date(Date.now() + 24 * 3_600_000));
      expect(dispatched).toContain(id);
    },
    30_000,
  );
});

/**
 * **平台日预算的计量器必须真的会加**(判官 delta 裁决)。
 *
 * 为什么这一族只能打真库、而且只能是行为断言:上一版的计量器是对 `AssetUnderstanding`
 * 两列 token 的**快照 SUM**,而每一次落盘都是 SET 覆写 —— 于是同一行跑三次付费调用,
 * 账面只留最后一次。理解那一侧本来只调一次,所以这个洞睡着;而「200 但正文用不了改成
 * 重试」把它叫醒了:一行三次真调用记成一次,计量器读数是真实花费的三分之一,
 * cap 于是在一整段行数区间里**永远不会触发**。
 *
 * 那句「一行三次重试数成 1」在旧注释里写着,还被实现逐字复现 —— 钱路守卫不能靠注释声明,
 * 只能靠一条会红的断言。这就是那条断言。
 */
describe("日预算计量器:同一行 N 次付费调用必须记 N 笔", () => {
  const USAGE = { inputTokens: 1_000, outputTokens: 10 };
  const UNIT_USD = understandingCostUsd(USAGE);

  /** 每次都回一段解析不出来的散文 ⇒ 每一趟都真的付费,而且不会走成 DONE。 */
  const alwaysUnusable: UnderstandingProvider = {
    name: "mock",
    async understand() {
      return { text: "I think it's a mug!", usage: { ...USAGE } };
    },
  };

  it(
    "同一行跑满三次付费调用 ⇒ 计量器读数 = 3 × 单价(不是 1 ×)",
    async () => {
      const assetId = await seedAsset();
      const id = newId();
      await prisma.assetUnderstanding.create({
        data: { id, ownerId: OWNER, assetId, kind: "image-caption", status: "QUEUED" },
      });

      // 增量断言:这个库是跨套件共用的,绝对值会被别人搅动,增量不会。
      const before = await understandingSpentTodayUsd();

      // 三次真调用 —— 前两次退回 QUEUED 并抛(队列重投),第三次落 PAUSED
      await expect(handleUnderstand({ understandingId: id }, 0, alwaysUnusable)).rejects.toThrow();
      await expect(handleUnderstand({ understandingId: id }, 1, alwaysUnusable)).rejects.toThrow();
      await expect(handleUnderstand({ understandingId: id }, 2, alwaysUnusable)).resolves.toBeNull();
      expect((await myRow(id))!.status).toBe("PAUSED");

      const after = await understandingSpentTodayUsd();
      expect(after - before).toBeCloseTo(3 * UNIT_USD, 10);
    },
    30_000,
  );

  it(
    "两行同时记账,一笔都不许丢(并发下的加法必须是原子的)",
    async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const assetId = await seedAsset();
        const id = newId();
        await prisma.assetUnderstanding.create({
          data: { id, ownerId: OWNER, assetId, kind: "image-caption", status: "QUEUED" },
        });
        ids.push(id);
      }

      const before = await understandingSpentTodayUsd();
      // 同一个 UTC 日的同一个桶,两笔并发写 —— 丢更新的实现在这里少记一笔
      await Promise.all(
        ids.map((id) => handleUnderstand({ understandingId: id }, 2, alwaysUnusable).catch(() => null)),
      );
      const after = await understandingSpentTodayUsd();
      expect(after - before).toBeCloseTo(2 * UNIT_USD, 10);
    },
    30_000,
  );
});

/**
 * **预扣式计量的原子性**(#1056;闸的那一半随 Founder 2026-09-02「只报警不拦」裁决拆掉)。
 *
 * 为什么只能打真库:要防的病是「两个副本同时给同一个日桶加一笔,其中一笔被丢更新吃掉」。
 * 假库里两次调用之间没有并发,我写的假件想让它原子它就原子 —— 那证明的是我的假件,不是
 * 那条 `INSERT … ON CONFLICT DO UPDATE` 真的在同一行上把两路排成队。
 *
 * 闸没了之后这条用例钉的东西**变了但没变弱**:以前钉「恰好一路挤得进去」,现在钉「两路
 * 都放行、而且两笔都记上了」—— 越线不再拦人,但一笔都不许丢,否则那条报警线就是瞎的。
 */
describe("平台日花费:记账是一条原子语句(并发下一笔都不丢,而且都放行)", () => {
  const CAPS = UNDERSTANDING_CAPS["image-caption"];
  const UNIT_USD = understandingCostUsd({
    inputTokens: CAPS.maxInputTokens,
    outputTokens: CAPS.maxOutputTokens,
  });

  it(
    "报警线只装得下一件时,两路并发**都放行**,而且两笔都记在桶上",
    async () => {
      // 这个库跨套件共用,所以基线现读、断言看增量。
      const before = await understandingSpentTodayUsd();
      const previous = process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD;
      process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = String(before + UNIT_USD * 1.5);
      try {
        const recorded = await Promise.all([
          recordUnderstandingBudget("image-caption"),
          recordUnderstandingBudget("image-caption"),
        ]);
        // 两路都拿到桶键 —— 越线只报警,不再有「挤不进去」这条出口。
        expect(recorded.map((r) => r.day).filter(Boolean)).toHaveLength(2);
        // 第二笔越了线,它自己看得见(报警的判据),但它照样被记上。
        expect(recorded.some((r) => r.overBudget)).toBe(true);
        // 丢更新的实现在这里只记一笔 —— 那正是 #1056 那条语句要防的。
        expect(await understandingSpentTodayUsd()).toBeCloseTo(before + 2 * UNIT_USD, 10);
      } finally {
        if (previous === undefined) delete process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD;
        else process.env.ASSET_UNDERSTANDING_DAILY_BUDGET_USD = previous;
      }
    },
    30_000,
  );
});

/**
 * **PAUSED_BALANCE 在真库上**(MONEY-A9 计费四则④)。两件事只有真库钉得住:
 * 新状态过不过得了 CHECK 约束(迁移真的跟上了),以及捞回那句 SQL 的 WHERE ——
 * 它跨了两张表比大小(行上的快照价 vs 账户余额),而那个比较正是「不无限重扫」的全部内容。
 */
describe("PAUSED_BALANCE:写得进真库,并且只在余额够了之后才捞回", () => {
  it(
    "余额不够 ⇒ 一轮都不捞;余额够了 ⇒ 下一轮回到 QUEUED",
    async () => {
      const assetId = await seedAsset();
      const id = newId();
      await setBalance(0);
      await prisma.assetUnderstanding.create({
        data: {
          id,
          ownerId: OWNER,
          assetId,
          kind: "image-caption",
          status: "PAUSED_BALANCE", // ← CHECK 约束跟上了没有,这一句说了算
          error: "waiting for credits",
          priceInternalSnapshot: 5,
          moneyRefId: `understanding:${id}`,
        },
      });
      expect((await myRow(id))!.status).toBe("PAUSED_BALANCE");

      // 余额 0 < 快照价 5 ⇒ 捞不回来(暂停期间不打供应商、不无限重扫)
      expect(await scanAssetsNeedingUnderstanding()).not.toContain(id);
      expect((await myRow(id))!.status).toBe("PAUSED_BALANCE");

      // 差一格也不行 —— 判据是 `>=`,不是「差不多够」
      await prisma.creditAccount.updateMany({ where: { orgId: OWNER }, data: { balance: 4 } });
      expect(await scanAssetsNeedingUnderstanding()).not.toContain(id);

      // 充到快照价 ⇒ 这一轮就回队列,error 也一起清掉(那句话不再是真的)
      await prisma.creditAccount.updateMany({ where: { orgId: OWNER }, data: { balance: 5 } });
      expect(await scanAssetsNeedingUnderstanding()).toContain(id);
      const back = (await myRow(id))!;
      expect(back.status).toBe("QUEUED");
      expect(back.error).toBeNull();
    },
    30_000,
  );
});

/**
 * **钱清道夫**(MONEY-A9):进程死在 reserve 和 settle 之间,留下一个没有 finalizer 的
 * 预扣。这一族只能打真库,因为要证明的东西全在一句原生 SQL 的 WHERE 里(`NOT EXISTS` 的
 * finalizer 子查询 + 前缀 + 时间窗),而假库里那句 SQL 根本不会被 Postgres 解析。
 */
describe("钱清道夫:漏在半路的理解预扣(真库)", () => {
  it(
    "退回商家余额 + 把还挂着这个回合的 RUNNING 行退回队列;第二遍是 no-op",
    async () => {
      const assetId = await seedAsset();
      const id = newId();
      const refId = `understanding:${id}`;
      // 预扣发生过之后的样子:余额扣了 1、reserved 挂着 1、台账一条 RESERVE、没有 finalizer。
      await setBalance(9, 1);
      await prisma.creditLedger.create({
        data: {
          id: newId(),
          orgId: OWNER,
          balanceDelta: -1,
          reservedDelta: 1,
          kind: "RESERVE",
          source: "SYSTEM",
          refId,
          idempotencyKey: `reserve:${refId}`,
        },
      });
      await prisma.assetUnderstanding.create({
        data: {
          id,
          ownerId: OWNER,
          assetId,
          kind: "image-caption",
          status: "RUNNING", // worker 死在这里
          priceInternalSnapshot: 1,
          moneyRefId: refId,
        },
      });

      // 时间窗:把 now 往后拨一小时以上,而不是去伪造 createdAt。
      const later = new Date(Date.now() + 2 * 3_600_000);
      expect(await reapStaleUnderstandingReservations(later)).toBeGreaterThanOrEqual(1);

      const refund = await prisma.creditLedger.findFirst({ where: { orgId: OWNER, refId, kind: "REFUND" } });
      expect(refund).not.toBeNull();
      expect(refund!.reason).toBe("understanding-reservation-reaper");
      const account = await prisma.creditAccount.findUnique({ where: { orgId: OWNER } });
      expect(account).toMatchObject({ balance: 10, reserved: 0 }); // 钱回到商家手上
      expect((await myRow(id))!.status).toBe("QUEUED"); // 素材回到队列,不是判死

      // 第二遍:finalizer 已经在了,这一行再也不会被扫到(名单不会越滚越大,钱也不会退第二次)
      expect(await reapStaleUnderstandingReservations(later)).toBe(0);
      expect(await prisma.creditLedger.count({ where: { orgId: OWNER, refId, kind: "REFUND" } })).toBe(1);
    },
    30_000,
  );
});

/**
 * **交付前直读终态**(#1046-P1 在这条链路上的同一形状;钱引擎⑤B)。
 *
 * 只有真库钉得住:病根是 `settleCredits` 内部那条 `createMany(skipDuplicates)` 对
 * 「REFUND 已经赢下 finalizer 唯一索引」是一次**静默空操作** —— 而「唯一索引真的会让它
 * 空操作」正是假库证明不了的那一件事。少了交付前那一读,商家白拿一份读好的产物,
 * 而权威账本记着 REFUND。
 */
describe("MONEY-A9:结算撞上既有 REFUND ⇒ 整笔回滚(不落 DONE、账本零新增)", () => {
  it(
    "跑到一半被清道夫退了款 ⇒ 结果不落盘、行不是 DONE、账本零新增,行退回 QUEUED 开新回合",
    async () => {
      const assetId = await seedAsset();
      const id = newId();
      const refId = `understanding:${id}`;
      await setBalance(10_000, 0);
      // 进门时的样子:有 RESERVE、**没有** finalizer ⇒ 恢复协议复用这个 hold 继续跑
      // (它不会换回合,所以这一趟的 settle 打的就是这个 refId)。
      await prisma.creditLedger.create({
        data: {
          id: newId(), orgId: OWNER, balanceDelta: -1, reservedDelta: 1,
          kind: "RESERVE", source: "SYSTEM", refId, idempotencyKey: `reserve:${refId}`,
        },
      });
      await prisma.assetUnderstanding.create({
        data: {
          id, ownerId: OWNER, assetId, kind: "image-caption",
          status: "QUEUED", priceInternalSnapshot: 1, moneyRefId: refId,
        },
      });

      // **清道夫在供应商往返的中途开火** —— 这就是那个窗口的真实形状(跑满 60 分钟的一趟,
      // 钱清道夫把它退了,而模型随后才把结果送回来)。
      const reaperMidFlight: UnderstandingProvider = {
        name: "mock",
        async understand(req) {
          await prisma.$transaction((tx) =>
            refundReservation(tx, { orgId: OWNER, refId, reason: "understanding-reservation-reaper" }),
          );
          return port.understand(req);
        },
      };

      const ledgerBefore = await prisma.creditLedger.count({ where: { orgId: OWNER, refId } });
      const balanceBefore = (await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: OWNER } })).balance;

      await expect(handleUnderstand({ understandingId: id }, 0, reaperMidFlight)).resolves.toBeNull();

      const after = await myRow(id);
      // 承重①:没有落 DONE —— 落了就是白送一份读好的产物,而权威账本记着 REFUND。
      expect(after!.status).not.toBe("DONE");
      expect(after!.status).toBe("QUEUED"); // 退回队列开新回合(恢复协议下一趟换 refId 重扣)
      expect(after!.data).toBeNull(); // 产物一格没落
      // 承重②:账本零新增(那笔 REFUND 是清道夫写的,不是这一趟写的),余额一分没再动。
      expect(await prisma.creditLedger.count({ where: { orgId: OWNER, refId } })).toBe(ledgerBefore + 1);
      expect(await prisma.creditLedger.count({ where: { orgId: OWNER, refId, kind: "SETTLE" } })).toBe(0);
      expect((await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: OWNER } })).balance).toBe(
        balanceBefore + 1, // 清道夫把那 1 credit 还回去了 —— 这一趟自己一分没动
      );
    },
    30_000,
  );
});

/**
 * **被暂停的 workspace**(MONEY-A13,规格 §7.5「不重投、不打供应商」;钱引擎⑤B)。
 *
 * 真库才证得了两件事:`reserveCredits` 里那道暂停咽喉真的会对「存在成员行且全部
 * suspended」抛出来(判定读的是真的 Membership 行),以及扫描器第 ④ 段那句
 * `NOT EXISTS … bool_and(...)` 真的把这些行挡在捞回之外 —— 少了它,余额充足的暂停商家
 * 每一件停着的素材都会每分钟被捞起来空转一轮。
 */
describe("MONEY-A13:暂停的 workspace ⇒ 停在 PAUSED_BALANCE,零供应商调用、零捞回", () => {
  async function suspendEveryone(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `${newId()}@a13-understand.test`, name: "a13" },
      select: { id: true },
    });
    const membershipId = newId();
    await prisma.membership.create({
      data: { id: membershipId, userId: user.id, orgId: OWNER, status: "suspended" },
    });
    return membershipId;
  }

  it(
    "全员 suspended ⇒ 行落 PAUSED_BALANCE、不抛(不抛 = 不重投)、供应商一次不调、扫描器不捞回",
    async () => {
      const assetId = await seedAsset();
      const id = newId();
      await setBalance(10_000); // 余额充足 —— 挡住它的是暂停,不是钱
      await prisma.assetUnderstanding.create({
        data: { id, ownerId: OWNER, assetId, kind: "image-caption", status: "QUEUED", priceInternalSnapshot: 1 },
      });
      const membershipId = await suspendEveryone();
      const understandCalls: unknown[] = [];
      const counting = {
        name: "mock",
        async understand(req: Parameters<UnderstandingProvider["understand"]>[0]) {
          understandCalls.push(req);
          return port.understand(req);
        },
      } satisfies UnderstandingProvider;

      try {
        // 承重的第一件事:**不抛**。抛 = pg-boss 重投 = 死信 = 30 分钟后清道夫退回 QUEUED = 死循环。
        await expect(handleUnderstand({ understandingId: id }, 0, counting)).resolves.toBeNull();
        expect(understandCalls).toHaveLength(0);
        expect((await myRow(id))!.status).toBe("PAUSED_BALANCE");
        // 账本零新增:拒绝是「什么都没发生」,不是「发生了再退一半」。
        expect(await prisma.creditLedger.count({ where: { orgId: OWNER, refId: `understanding:${id}` } })).toBe(0);

        // 扫描器第 ④ 段:余额够,但这个 workspace 停着 ⇒ 一轮都不捞。
        expect(await scanAssetsNeedingUnderstanding()).not.toContain(id);
        expect((await myRow(id))!.status).toBe("PAUSED_BALANCE");

        // 解除暂停 ⇒ 下一轮自然回到队列,不需要任何补偿性回填。
        await prisma.membership.update({ where: { id: membershipId }, data: { status: "active" } });
        expect(await scanAssetsNeedingUnderstanding()).toContain(id);
        expect((await myRow(id))!.status).toBe("QUEUED");
      } finally {
        await prisma.membership.deleteMany({ where: { orgId: OWNER } });
        await prisma.user.deleteMany({ where: { email: { endsWith: "@a13-understand.test" } } });
      }
    },
    30_000,
  );
});

describe("PAUSED 是真库上合法的状态(CHECK 约束跟上了)", () => {
  it(
    "写得进 PAUSED,而且停够之后被扫描器捡回 QUEUED",
    async () => {
      const assetId = await seedAsset();
      const id = newId();
      await prisma.assetUnderstanding.create({
        data: { id, ownerId: OWNER, assetId, kind: "image-caption", status: "PAUSED", error: "paused" },
      });
      expect((await myRow(id))!.status).toBe("PAUSED");

      const dispatched = await scanAssetsNeedingUnderstanding(new Date(Date.now() + 24 * 3_600_000));
      expect(dispatched).toContain(id);
      expect((await myRow(id))!.status).toBe("QUEUED");
    },
    30_000,
  );
});
