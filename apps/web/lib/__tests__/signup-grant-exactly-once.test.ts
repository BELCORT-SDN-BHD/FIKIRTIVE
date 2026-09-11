/**
 * signup-grant-exactly-once.test.ts — #543 MONEY PATH.
 *
 * The signup welcome grant is a CreditLedger write. Whatever re-fires it — a second
 * verification click, a re-login, two browser tabs racing, a retried request — the
 * merchant must end up with exactly ONE grant row and exactly SIGNUP_GRANT_CREDITS.
 * Exactly-once is enforced by the DB: grantCreditsTx inserts with
 * `skipDuplicates` on the (orgId, idempotencyKey) unique index, so the duplicate
 * insert affects 0 rows and the account is never touched a second time.
 *
 * These tests use the REAL Prisma client against the local *_test database.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = "";
  process.env.FOUNDER_ADMIN_EMAILS = "";
});

const { prisma } = await import("@fikirtive/db");
const { SIGNUP_GRANT_CREDITS } = await import("@fikirtive/core");
const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
const { convergeIdentity } = await import("@/lib/better-auth/converge");

async function freshUser(name?: string): Promise<{ id: string; email: string }> {
  const email = `grant-${randomUUID()}@fikirtive.test`;
  return prisma.user.create({
    data: { id: `usr_${randomUUID()}`, email, ...(name ? { name } : {}) },
    select: { id: true, email: true },
  });
}

async function ledgerFacts(orgId: string) {
  const rows = await prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  const account = await prisma.creditAccount.findUnique({ where: { orgId } });
  return { rows, balance: account?.balance ?? null, reserved: account?.reserved ?? null };
}

describe("#543 signup grant — exactly-once", () => {
  it("grants SIGNUP_GRANT_CREDITS once, under the stable key, attributed to the bootstrap writer", async () => {
    const user = await freshUser("Roti Bakar Co");
    const orgId = await bootstrapPersonalOrg(user.id, user.email);
    expect(orgId).toBe(`org_${user.id}`);

    const { rows, balance, reserved } = await ledgerFacts(orgId!);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("GRANT");
    expect(rows[0]!.source).toBe("BETA");
    expect(rows[0]!.balanceDelta).toBe(SIGNUP_GRANT_CREDITS);
    expect(rows[0]!.reservedDelta).toBe(0);
    expect(rows[0]!.idempotencyKey).toBe(`signup:${orgId}`);
    expect(rows[0]!.createdBy).toBe("auth:bootstrap-personal-org");
    expect(balance).toBe(SIGNUP_GRANT_CREDITS);
    expect(reserved).toBe(0);
    // the ledger reconstructs the account (balance == Σ balanceDelta)
    expect(rows.reduce((s, r) => s + r.balanceDelta, 0)).toBe(balance);
  });

  it("a SECOND trigger is a zero-effect replay — one row, same balance", async () => {
    const user = await freshUser("Second Trigger Shop");
    const orgId = (await bootstrapPersonalOrg(user.id, user.email))!;
    const first = await ledgerFacts(orgId);

    await bootstrapPersonalOrg(user.id, user.email);
    await convergeIdentity({ email: user.email, name: "Second Trigger Shop", emailVerified: true });
    await convergeIdentity({ email: user.email, name: "Second Trigger Shop", emailVerified: true });

    const after = await ledgerFacts(orgId);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.id).toBe(first.rows[0]!.id);
    expect(after.balance).toBe(SIGNUP_GRANT_CREDITS);
  });

  it("CONCURRENT triggers (two tabs) still grant exactly once", async () => {
    const user = await freshUser("Race Condition Cafe");
    const orgId = `org_${user.id}`;

    await Promise.all([
      bootstrapPersonalOrg(user.id, user.email),
      bootstrapPersonalOrg(user.id, user.email),
      bootstrapPersonalOrg(user.id, user.email),
    ]);

    const { rows, balance } = await ledgerFacts(orgId);
    expect(rows).toHaveLength(1);
    expect(balance).toBe(SIGNUP_GRANT_CREDITS);
  });

  /**
   * SIGNIN-A17 —— 「赠金只发给第一个（幂等键按去掉 `+tag` 与点号变体后的邮箱算）」。
   *
   * 这是钱路，所以它是**数据库唯一约束**证出来的，不是一次查询的运气：`signup_grant_claim` 的
   * 主键就是归一化后的邮箱，在开户那笔事务里 INSERT … ON CONFLICT DO NOTHING。
   *
   * RED before：三个变体是三个 org，`CreditLedger` 的 (orgId, idempotencyKey) 唯一约束对它们
   * 一个都拦不住 —— 三笔赠金，三份真实供应商成本。规格 §1.5 算过：一千个号约 875 美元。
   */
  it("SIGNIN-A17 —— 同一个真实收件箱的 +tag 与去点变体只领一笔赠金，账号照建", async () => {
    const stem = `a17${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const variants = [
      `${stem}@gmail.com`,
      `${stem}+001@gmail.com`,
      `${stem.slice(0, 4)}.${stem.slice(4)}@gmail.com`, // gmail 去点
    ];
    const orgs: string[] = [];
    for (const email of variants) {
      const user = await prisma.user.create({
        data: { id: `usr_${randomUUID()}`, email },
        select: { id: true, email: true },
      });
      orgs.push((await bootstrapPersonalOrg(user.id, user.email))!);
    }

    // 账号与工作区都建出来了 —— A17 明写 30 个号都进得来，被归一的只有赠金。
    expect(new Set(orgs).size).toBe(variants.length);
    for (const orgId of orgs) {
      expect(await prisma.membership.count({ where: { orgId } })).toBe(1);
    }

    // 赠金只有一笔，落在先到的那个工作区。
    const granted: string[] = [];
    for (const orgId of orgs) {
      const rows = await prisma.creditLedger.findMany({ where: { orgId, kind: "GRANT" } });
      if (rows.length) granted.push(orgId);
      expect(rows.length).toBeLessThanOrEqual(1);
    }
    expect(granted).toEqual([orgs[0]]);
  });

  /** SIGNIN-A17 —— 两个变体同时开户（两个标签页、两台机器）也只可能有一个拿到赠金：
   *  去重键是主键，并发插入只有一个赢。 */
  it("SIGNIN-A17 —— 两个变体并发开户，赠金仍然恰好一笔", async () => {
    const stem = `a17race${randomUUID().replace(/-/g, "")}`;
    const pair = [`${stem}@gmail.com`, `${stem}+two@gmail.com`];
    const users = [];
    for (const email of pair) {
      users.push(
        await prisma.user.create({
          data: { id: `usr_${randomUUID()}`, email },
          select: { id: true, email: true },
        }),
      );
    }
    const orgs = await Promise.all(users.map((u) => bootstrapPersonalOrg(u.id, u.email)));

    const grantRows = await prisma.creditLedger.count({
      where: { orgId: { in: orgs.filter(Boolean) as string[] }, kind: "GRANT" },
    });
    expect(grantRows).toBe(1);
  });

  /**
   * SIGNIN-A17 —— `googlemail.com` 与 `gmail.com` 是同一个收件箱（判官 r1 P1，2026-09-11）。
   *
   * 判官在干净测试库上投了四个地址：`X@gmail.com` / `X@googlemail.com` / 去点变体 / `+tag` 变体，
   * 四封信全部落进同一个 Google 收件箱，却拿到 **2** 笔赠金 —— 折域漏了。这一条把那次探针钉进围栏。
   *
   * RED before：`grantRows` 是 2（gmail 一笔、googlemail 一笔）。
   */
  it("SIGNIN-A17 —— googlemail.com 的变体与 gmail.com 是同一个收件箱，合起来只领一笔赠金", async () => {
    const stem = `a17gm${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const variants = [
      `${stem}@gmail.com`,
      `${stem}@googlemail.com`,
      `${stem.slice(0, 4)}.${stem.slice(4)}@googlemail.com`,
      `${stem}+ops@googlemail.com`,
    ];
    const orgs: string[] = [];
    for (const email of variants) {
      const user = await prisma.user.create({
        data: { id: `usr_${randomUUID()}`, email },
        select: { id: true, email: true },
      });
      orgs.push((await bootstrapPersonalOrg(user.id, user.email))!);
    }

    // 四个账号都建得出来（A17 明写号照建，被归一的只有赠金）。
    expect(new Set(orgs).size).toBe(variants.length);

    const grantRows = await prisma.creditLedger.count({
      where: { orgId: { in: orgs }, kind: "GRANT" },
    });
    expect(grantRows).toBe(1);
  });

  /** 不同域的同名 local part 不是同一个人：去点只对 Gmail 自己的域做，否则会把两个真实的人
   *  合并成一个，反而扣掉其中一个的开户赠金。 */
  it("SIGNIN-A17 —— 非 gmail 域不做去点归一：两个真实的人各拿一笔赠金", async () => {
    const stem = `a17dots${randomUUID().replace(/-/g, "")}`;
    const pair = [`${stem}@shop.test`, `${stem.slice(0, 4)}.${stem.slice(4)}@shop.test`];
    const orgs: string[] = [];
    for (const email of pair) {
      const user = await prisma.user.create({
        data: { id: `usr_${randomUUID()}`, email },
        select: { id: true, email: true },
      });
      orgs.push((await bootstrapPersonalOrg(user.id, user.email))!);
    }
    for (const orgId of orgs) {
      expect(await prisma.creditLedger.count({ where: { orgId, kind: "GRANT" } })).toBe(1);
    }
  });

  it("an UNVERIFIED identity converges nothing — no user row, no org, no money", async () => {
    const email = `unverified-${randomUUID()}@fikirtive.test`;
    await convergeIdentity({ email, name: "Not Verified Yet", emailVerified: false });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.organization.count({ where: { name: "Not Verified Yet" } })).toBe(0);
  });

  it("#544 — a verified convergence stamps the canonical User.emailVerified, and is set-once", async () => {
    const email = `verify-stamp-${randomUUID()}@fikirtive.test`;
    await convergeIdentity({ email, name: "Verified Shop", emailVerified: true });

    const user = await prisma.user.findUnique({ where: { email }, select: { emailVerified: true } });
    expect(user?.emailVerified).toBeInstanceOf(Date);

    // Set-once: a later convergence never re-stamps a fresh timestamp over the original.
    const firstStamp = user!.emailVerified!;
    await convergeIdentity({ email, name: "Verified Shop", emailVerified: true });
    const again = await prisma.user.findUnique({ where: { email }, select: { emailVerified: true } });
    expect(again?.emailVerified?.getTime()).toBe(firstStamp.getTime());
  });

  /**
   * SIGNIN-A10 —— 「工作区名都为空（等商家在设置页填店铺名）」，两扇门一律如此。
   *
   * RED before：这一条断言的正好相反 —— 带了 `User.name` 的账号会拿到一个以那个名字命名的
   * 工作区。#680 立的规矩是「没收集店铺名的门，工作区就没有名字」，实现方式是读 `User.name`；
   * 对码门那是空串，所以它一直看起来是对的，直到 Google 门把**个人姓名**写进那个字段，同一段
   * 代码给同一件事写出两种结果。规格 §1.4 拍板：店铺名不是人名，两扇门都留空。
   */
  it("SIGNIN-A10 —— 首登的工作区名一律为空，即使身份带着一个人名", async () => {
    const named = await freshUser("Aisha Rahman");
    const namedOrg = (await bootstrapPersonalOrg(named.id, named.email))!;
    expect((await prisma.organization.findUnique({ where: { id: namedOrg } }))?.name).toBe("");

    const anonymous = await freshUser();
    const anonymousOrg = (await bootstrapPersonalOrg(anonymous.id, anonymous.email))!;
    expect((await prisma.organization.findUnique({ where: { id: anonymousOrg } }))?.name).toBe("");
  });

  it("never RENAMES an existing workspace on a later bootstrap", async () => {
    const user = await freshUser();
    const orgId = (await bootstrapPersonalOrg(user.id, user.email))!;
    // 商家在设置页填了店铺名之后，再登录一次不许把它擦掉。
    await prisma.organization.update({ where: { id: orgId }, data: { name: "Kedai Kopi Aman" } });
    await bootstrapPersonalOrg(user.id, user.email);
    expect((await prisma.organization.findUnique({ where: { id: orgId } }))?.name).toBe("Kedai Kopi Aman");
  });
});
