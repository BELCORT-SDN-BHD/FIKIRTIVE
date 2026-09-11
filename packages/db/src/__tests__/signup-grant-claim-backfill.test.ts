/**
 * SIGNIN-A17 —— 迁移 20260910190000_signup_grant_claim 的**回填**到底做了什么
 * （规格 `docs/specs/sign-in.md` 已冻结 · v1 §1.5；执行票 #1317；判官 r1 P1，2026-09-11）。
 *
 * 为什么必须有回填：`signup_grant_claim` 是一张新表，升级那一刻它是空的。于是每一个**已经
 * 领过**开户赠金的真实收件箱，都还可以拿一个变体地址（`me+new@gmail.com`）在**另一个**工作区
 * 再领一笔 —— 新 org 的 claim 主键是空的，`CreditLedger` 的 `signup:<orgId>` 那条键在另一个
 * org 上也拦不住。A17 那句「一个真实收件箱只领一次」于是只对新库成立，对存量数据不成立。
 *
 * 和同族的 `brand-product-identity-backfill.test.ts` 一样：这里不复述那段 SQL，而是**把迁移
 * 文件原样读出来执行**。改了那份 SQL 而没有改这里，这里就红。
 *
 * 老形状怎么造：全新库已经把这张表建好了，所以每条用例先把它 DROP 掉，插入「升级前」的行
 * （既有 org ＋ `signup:<orgId>` 那笔赠金，没有任何 claim 行），再让迁移自己把表建回来并回填。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { prisma } from "../index.js";
import { seedOrg } from "../../test/setup.js";

const MIGRATION_SQL = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../prisma/migrations/20260910190000_signup_grant_claim/migration.sql",
  ),
  "utf8",
);

/** 整份迁移一次送进去，用 `pg` 的简单查询协议（多语句，`$executeRawUnsafe` 送不了）。 */
async function runMigration(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(MIGRATION_SQL);
  } finally {
    await client.end();
  }
}

/** 造一个「升级前」的商家：User + Organization + CreditAccount + 那一行开户赠金。 */
async function seedGrantedMerchant(email: string, grantedAt: Date): Promise<string> {
  const userId = `usr_${randomUUID()}`;
  const orgId = `org_${userId}`;
  await prisma.user.create({ data: { id: userId, email } });
  await seedOrg(orgId, 2500);
  await prisma.creditLedger.create({
    data: {
      id: `led_${randomUUID()}`,
      orgId,
      balanceDelta: 2500,
      reservedDelta: 0,
      kind: "GRANT",
      source: "BETA",
      reason: "signup welcome grant",
      idempotencyKey: `signup:${orgId}`,
      createdBy: "auth:bootstrap-personal-org",
      createdAt: grantedAt,
    },
  });
  return orgId;
}

async function claimRows(): Promise<{ canonicalEmail: string; orgId: string }[]> {
  return prisma.signupGrantClaim.findMany({
    select: { canonicalEmail: true, orgId: true },
    orderBy: { canonicalEmail: "asc" },
  });
}

beforeEach(async () => {
  // setup.ts 的 TRUNCATE 只扫 Organization 那一棵；这两张表要自己清。
  await prisma.$executeRawUnsafe(`TRUNCATE "signup_grant_claim"`);
  await prisma.$executeRawUnsafe(`TRUNCATE "User" CASCADE`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "signup_grant_claim"`);
});

// 这个文件把表 DROP 了又建回来。同一个 vitest 进程里后面还有别的文件（packages/db 是
// singleFork 串行），所以无论这里成功还是失败，走的时候都必须把表按迁移原样留下。
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "signup_grant_claim"`);
  await runMigration();
});

describe("SIGNIN-A17 —— signup_grant_claim 的回填", () => {
  /**
   * RED before：迁移只 CREATE TABLE、明写「不回填」，所以这里查出来是 0 行 —— 存量收件箱
   * 全部还能再领一次。
   */
  it("SIGNIN-A17 —— 回填给每一个已经领过赠金的存量收件箱补上一行 claim", async () => {
    const orgA = await seedGrantedMerchant("aisha@shop.test", new Date("2026-08-01T00:00:00Z"));
    const orgB = await seedGrantedMerchant("me@gmail.com", new Date("2026-08-02T00:00:00Z"));

    await runMigration();

    expect(await claimRows()).toEqual([
      { canonicalEmail: "aisha@shop.test", orgId: orgA },
      { canonicalEmail: "me@gmail.com", orgId: orgB },
    ]);
  });

  /**
   * 回填算出来的键必须与 `packages/core` 的 `canonicalGrantEmail` 逐字一致 —— 否则升级后
   * 那个收件箱的变体地址仍然拿得到一个空的主键。四个写法、同一个 Google 收件箱、一个键。
   */
  it("SIGNIN-A17 —— 回填的键与 canonicalGrantEmail 一致：+tag、去点、googlemail 都折成同一个", async () => {
    const org = await seedGrantedMerchant("M.E+001@GoogleMail.com", new Date("2026-08-03T00:00:00Z"));

    await runMigration();

    expect(await claimRows()).toEqual([{ canonicalEmail: "me@gmail.com", orgId: org }]);
  });

  /** 同一个真实收件箱在存量里已经有好几个 org（正是这条缺陷造出来的那些）：主键只容得下一行，
   *  记**最早**领的那一个，其余的不许把它顶掉。 */
  it("SIGNIN-A17 —— 同一个收件箱的多个存量工作区只留一行 claim，记最早领的那次", async () => {
    const first = await seedGrantedMerchant("dup@gmail.com", new Date("2026-08-01T00:00:00Z"));
    await seedGrantedMerchant("d.up+later@googlemail.com", new Date("2026-08-09T00:00:00Z"));

    await runMigration();

    expect(await claimRows()).toEqual([{ canonicalEmail: "dup@gmail.com", orgId: first }]);
  });

  /** 只回填**真的领过**的那些。没有 `signup:<orgId>` 那一行的 org（受邀但没走开户赠金那条路、
   *  或是被搬进来的历史数据）不许被记成领过 —— 那会把一笔它应得的赠金永远关在门外。 */
  it("SIGNIN-A17 —— 没领过赠金的存量工作区不回填，它那一笔仍然领得到", async () => {
    const userId = `usr_${randomUUID()}`;
    await prisma.user.create({ data: { id: userId, email: "never-granted@shop.test" } });
    await seedOrg(`org_${userId}`, 0);

    await runMigration();

    expect(await claimRows()).toEqual([]);
  });
});
