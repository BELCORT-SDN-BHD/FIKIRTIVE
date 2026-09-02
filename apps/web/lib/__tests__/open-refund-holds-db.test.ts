/**
 * MONEY-A14 —— 未收口的人工退款清单(真数据库)。
 *
 * 这张清单是钱的安全网:一张 hold 没被列出来,就是一笔商家花不了、也没人记得去收口的 credits。
 * 它现在由一句 `NOT EXISTS` 反连接的原生 SQL 读出来(复审四 P2),mock 出来的 prisma 只会把那句
 * SQL 当字符串,证明不了租户约束、也证明不了「先减后截」。所以这三件事钉在真库上:
 *   ① 租户约束:别的 org 的 hold 一张都不许出现;
 *   ② 先减后截(复审三 P1):25 张更新且已收口 + 1 张更老仍开着 ⇒ 老的那张照样在;
 *   ③ hasMore:开着的比一页还多时如实说还有。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("@/lib/auth-guard", () => ({
  requireRole: vi.fn(async () => ({ email: "founder@fikirtive.test", roles: ["super-admin"], role: "super-admin" })),
  requireOwner: vi.fn(async () => ({ email: "founder@fikirtive.test", ownerId: "founder" })),
}));

const { prisma } = await import("@fikirtive/db");
const { getTenantDetail } = await import("@/lib/tenant-admin");

const TAG = "open-holds";
const ORG_A = `org_${TAG}_a`;
const ORG_B = `org_${TAG}_b`;
let seq = 0;

/** 一张退款单的 RESERVE 行;`reason` 就是钉在账本上的那份事实。 */
async function hold(orgId: string, ticket: string, minutesAgo: number) {
  await prisma.creditLedger.create({
    data: {
      id: `cl_${TAG}_${seq}`, orgId, balanceDelta: 0, reservedDelta: 1000,
      kind: "RESERVE", source: "ADMIN", refId: `manual-refund:${ticket}`,
      // Stripe 的 id 是纯字母数字(账本上钉的那份事实照它的形状读回来)。
      reason: `pi:pi_${ticket.replace(/-/g, "")}|req:1000|held:1000|minor:4166|cur:myr|partial:0`,
      idempotencyKey: `reserve:${TAG}:${seq}`, createdBy: "founder@fikirtive.test",
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    },
  });
  seq += 1;
}

/** 收口那张单(落账或释放都算终结)。 */
async function close(orgId: string, ticket: string, kind: "SETTLE" | "REFUND") {
  await prisma.creditLedger.create({
    data: {
      id: `cl_${TAG}_${seq}`, orgId, balanceDelta: kind === "SETTLE" ? -1000 : 0, reservedDelta: -1000,
      kind, source: "ADMIN", refId: `manual-refund:${ticket}`, reason: `${TAG} closed`,
      idempotencyKey: `${kind.toLowerCase()}:${TAG}:${seq}`, createdBy: "founder@fikirtive.test",
    },
  });
  seq += 1;
}

async function makeOrg(id: string, email: string) {
  await prisma.organization.upsert({ where: { id }, update: {}, create: { id, name: `${id} shop` } });
  const user = await prisma.user.create({ data: { email, name: email, role: "viewer" }, select: { id: true } });
  await prisma.membership.create({ data: { id: `mem_${TAG}_${user.id}`, userId: user.id, orgId: id, role: "owner", status: "active" } });
  return user.id;
}

const userIds: string[] = [];

/** 上一趟被中断留下的行会撞固定 id;先自清,重跑才是幂等的。 */
async function wipeFixtures() {
  await prisma.creditLedger.deleteMany({ where: { id: { startsWith: `cl_${TAG}_` } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
}

beforeAll(async () => {
  await wipeFixtures();
  userIds.push(await makeOrg(ORG_A, `${TAG}-a@example.test`));
  userIds.push(await makeOrg(ORG_B, `${TAG}-b@example.test`));

  // A:一张开着的(老)、一张落了账的、一张释放了的。
  await hold(ORG_A, "a-open", 600);
  await hold(ORG_A, "a-settled", 10);
  await close(ORG_A, "a-settled", "SETTLE");
  await hold(ORG_A, "a-released", 5);
  await close(ORG_A, "a-released", "REFUND");
  // B:一张开着的 —— 它绝不能出现在 A 的页面上。
  await hold(ORG_B, "b-open", 1);
});

afterAll(wipeFixtures);

describe("MONEY-A14 — 未收口清单只出本租户、且已收口的不出", () => {
  it("A 的页面只列 A 那张开着的:已 SETTLE 的、已 REFUND 的、B 的,一张都不出现", async () => {
    const detail = await getTenantDetail(ORG_A);

    expect(detail!.openManualRefunds.map((h) => h.refundId)).toEqual(["a-open"]);
    expect(detail!.openManualRefundsHasMore).toBe(false);
    // 事实是从 RESERVE 行 reason 上读回来的,不是页面上编的。
    expect(detail!.openManualRefunds[0]).toMatchObject({
      paymentIntentId: "pi_aopen", heldDisplay: 100, requestedDisplay: 100, amountMinor: 4166, currency: "myr", allowPartial: false,
    });
  });

  it("B 的页面只列 B 那张,互不串台", async () => {
    const detail = await getTenantDetail(ORG_B);
    expect(detail!.openManualRefunds.map((h) => h.refundId)).toEqual(["b-open"]);
  });
});

describe("MONEY-A14 — 先减后截:更老的 open hold 不会被更新的单挤掉", () => {
  it("25 张更新且都已收口 + 1 张更老仍开着 ⇒ 老的那张照样在,而且是唯一一张", async () => {
    for (let i = 0; i < 25; i += 1) {
      await hold(ORG_B, `b-done-${i}`, 1);
      await close(ORG_B, `b-done-${i}`, "SETTLE");
    }

    const detail = await getTenantDetail(ORG_B);

    expect(detail!.openManualRefunds.map((h) => h.refundId)).toEqual(["b-open"]);
    expect(detail!.openManualRefundsHasMore).toBe(false);
  });

  it("开着的比一页还多 ⇒ 只列 25 张,并说还有更早的", async () => {
    for (let i = 0; i < 25; i += 1) await hold(ORG_B, `b-more-${i}`, 1);

    const detail = await getTenantDetail(ORG_B);

    expect(detail!.openManualRefunds).toHaveLength(25);
    expect(detail!.openManualRefundsHasMore).toBe(true);
  });
});
