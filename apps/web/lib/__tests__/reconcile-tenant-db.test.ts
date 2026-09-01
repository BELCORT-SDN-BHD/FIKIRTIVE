/**
 * reconcile-tenant-db —— 关闭对账缺口的**双租户真行为**证据(MONEY-A12,复审三 P2-3)。
 *
 * 真 Postgres(*_test)、真 Prisma、真 ActionEvent 与真 CreditLedger 行;只有 `requireRole`
 * 是替身(它要一个 Better Auth session,而这里要证的不是登录)。与
 * `campaign-confirm-ledger.test.ts` 同一套配方。
 *
 * 证三件事,都是「mock 断言证不了」的那一类:
 *   ① **跨租户**:拿 A 家的补发行去关 B 家的缺口 —— 数据库里两行都真实存在,查询必须查不到它。
 *   ② **指名**:同一个商家、同额、形态也对,但那一行没写这一笔 session id ⇒ 拒。
 *   ③ **一行只关一个缺口**:同一行补发关掉第一笔之后,第二笔当场被拒,且第一条关闭行不受影响。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, RECONCILE_OBSERVED_TYPE, reconcileClosureId, reconcileCreditUseId, reconcileObservationId } from "@fikirtive/core";

const requireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole }));

const { closeReconcileObservation } = await import("@/lib/reconcile-actions");
const { prisma } = await import("@fikirtive/db");

// 与其它真库用例同一道守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const CREDITS = 220; // Standard 包

let orgA: string;
let orgB: string;
let sessionA: string;
let sessionB: string;

/** 建一个组织 + 一笔已支付却没入账的观察行(哨兵会写的那一种)。 */
async function seedGap(credits = CREDITS): Promise<{ orgId: string; sessionId: string }> {
  const orgId = `org_${randomUUID()}`;
  const sessionId = `cs_test_${randomUUID().replace(/-/g, "")}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: 0, reserved: 0 } });
  await prisma.actionEvent.create({
    data: {
      id: reconcileObservationId(sessionId),
      ownerId: orgId,
      type: RECONCILE_OBSERVED_TYPE,
      payload: { sessionId, orgId, credits, amountTotal: 10000, currency: "MYR", firstSeenAt: new Date().toISOString(), ledgerVerified: true },
    },
  });
  return { orgId, sessionId };
}

/** 一笔真的手工补发:GRANT、金额与缺口相符、reason 里粘着 session id。 */
async function seedGrant(orgId: string, namesSession: string | null, key: string): Promise<string> {
  const row = await prisma.creditLedger.create({
    data: {
      id: `cl_${randomUUID()}`,
      orgId,
      balanceDelta: CREDITS * INTERNAL_PER_DISPLAY,
      reservedDelta: 0,
      kind: "GRANT",
      source: "ADMIN",
      reason: namesSession ? `manual re-grant for ${namesSession}` : "goodwill top-up",
      idempotencyKey: key,
      createdBy: "finance@fikirtive.test",
    },
  });
  return row.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ email: "finance@fikirtive.test", roles: ["finance"], role: "finance" });
  ({ orgId: orgA, sessionId: sessionA } = await seedGap());
  ({ orgId: orgB, sessionId: sessionB } = await seedGap());
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("MONEY-A12 双租户:一家的补发关不掉另一家的缺口", () => {
  it("拿 A 家的补发行去关 B 家的缺口 ⇒ 拒绝(两行都真实存在,查询必须被 org 钉住)", async () => {
    const key = `grant:${randomUUID()}`;
    await seedGrant(orgA, sessionB, key); // A 家的钱,却写着 B 家那一笔 session —— 更像得逞的形状

    const res = await closeReconcileObservation({ sessionId: sessionB, disposition: "credited_manually", ledgerRef: key });

    expect("error" in res && res.error).toContain("No credits-ledger row for THIS merchant");
    // B 那一笔缺口**没有**被关掉 —— 它还在追踪名单里。
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionB) } })).toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("用 B 家自己的、指名了这一笔 session 的补发行 ⇒ 通过", async () => {
    const key = `grant:${randomUUID()}`;
    const rowId = await seedGrant(orgB, sessionB, key);

    const res = await closeReconcileObservation({ sessionId: sessionB, disposition: "credited_manually", ledgerRef: key });

    expect(res).toEqual({ ok: true });
    const closure = await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionB) } });
    expect(closure?.ownerId).toBe(orgB);
    expect((closure?.payload as { ledgerRowId?: string }).ledgerRowId).toBe(rowId);
    // 占用标记与关闭行是同一笔事务的两条写 —— 两条都在。
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileCreditUseId(rowId) } })).not.toBeNull();
    // A 家一格没动。
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionA) } })).toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("复审三 P1(a):同商家、同额、形态也对,但那一行不指名这一笔 session ⇒ 拒绝", async () => {
    const key = `grant:${randomUUID()}`;
    await seedGrant(orgB, null, key);

    const res = await closeReconcileObservation({ sessionId: sessionB, disposition: "credited_manually", ledgerRef: key });

    expect("error" in res && res.error).toContain("does not name this payment");
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionB) } })).toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("复审四 P1:reason 里写的是**更长的相似 id** ⇒ 拒绝(真库里两行都在,只有 token 边界挡得住)", async () => {
    const key = `grant:${randomUUID()}`;
    // 这一笔补发指的是 `<sessionB>4` —— 另一笔付款。子串匹配会把它当成命中。
    await seedGrant(orgB, `${sessionB}4`, key);

    const res = await closeReconcileObservation({ sessionId: sessionB, disposition: "credited_manually", ledgerRef: key });

    expect("error" in res && res.error).toContain("does not name this payment");
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionB) } })).toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("复审三 P1(b):同一行补发关掉第一笔之后,第二笔当场被拒,且第一条关闭行不受影响", async () => {
    // 同一个商家的两笔缺口,同额。一笔 220 的补发只能顶掉其中一笔 —— 另一笔仍然欠着。
    const second = `cs_test_${randomUUID().replace(/-/g, "")}`;
    await prisma.actionEvent.create({
      data: {
        id: reconcileObservationId(second),
        ownerId: orgB,
        type: RECONCILE_OBSERVED_TYPE,
        payload: { sessionId: second, orgId: orgB, credits: CREDITS, amountTotal: 10000, currency: "MYR", firstSeenAt: new Date().toISOString() },
      },
    });
    const key = `grant:${randomUUID()}`;
    // reason 把两笔 session 都粘上 —— 「指名」这一关都过得去,挡住第二笔的只能是占用标记。
    const rowId = await prisma.creditLedger
      .create({
        data: {
          id: `cl_${randomUUID()}`,
          orgId: orgB,
          balanceDelta: CREDITS * INTERNAL_PER_DISPLAY,
          reservedDelta: 0,
          kind: "GRANT",
          source: "ADMIN",
          reason: `manual re-grant for ${sessionB} and ${second}`,
          idempotencyKey: key,
          createdBy: "finance@fikirtive.test",
        },
      })
      .then((r) => r.id);

    const first = await closeReconcileObservation({ sessionId: sessionB, disposition: "credited_manually", ledgerRef: key });
    expect(first).toEqual({ ok: true });

    const again = await closeReconcileObservation({ sessionId: second, disposition: "credited_manually", ledgerRef: key });

    expect("error" in again && again.error).toContain(`already used to close another gap (${sessionB})`);
    // 第二笔没被关掉,第一笔的关闭行原样还在,占用标记仍然记着第一笔。
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(second) } })).toBeNull();
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionB) } })).not.toBeNull();
    const marker = await prisma.actionEvent.findUnique({ where: { id: reconcileCreditUseId(rowId) } });
    expect((marker?.payload as { sessionId?: string }).sessionId).toBe(sessionB);
  }, DB_CASE_TIMEOUT_MS);
});
