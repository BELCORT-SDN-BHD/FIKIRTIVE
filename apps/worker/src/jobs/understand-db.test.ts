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

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import type { UnderstandingProvider } from "@fikirtive/generation";
import { handleUnderstand, scanAssetsNeedingUnderstanding } from "./understand.js";

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
});

afterAll(async () => {
  await prisma.assetUnderstanding.deleteMany({ where: { ownerId: OWNER } });
  await prisma.brandRecord.deleteMany({ where: { ownerId: OWNER } });
  await prisma.memory.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
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

      expect(await prisma.$executeRawUnsafe(RECOVERY_SQL)).toBe(1); // 只有一行够格

      const after = async (id: string) => (await myRow(id))!;
      expect(await after(killedByConfig)).toMatchObject({ status: "QUEUED", error: null });
      // 越界清理的三个反例:真读不了的、别的终态、已经读懂的 —— 一行都不许被碰
      expect((await after(reallyUnreadable)).status).toBe("FAILED");
      expect((await after(skippedTooBig)).status).toBe("SKIPPED");
      expect((await after(done)).status).toBe("DONE");

      // 幂等:第二遍一行都匹配不到(status 和 error 已经一起改掉了)
      expect(await prisma.$executeRawUnsafe(RECOVERY_SQL)).toBe(0);
      expect(await after(killedByConfig)).toMatchObject({ status: "QUEUED", error: null });
      expect((await after(reallyUnreadable)).status).toBe("FAILED");
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
