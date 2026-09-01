/**
 * MONEY-A14(复审二 P2-4)—— admin 那张「Large grants」表必须由**窗口累计**派生,
 * 一行一个 workspace,而不是「最新 N 条人工钱明细」。
 *
 * 被钉死的缺陷:表若按最新 24 条明细构造,一个已经超限的 workspace 只要别的租户在它之后
 * 又写了 24 行,就从表上、也从「超限」计数里**消失**——而这张表存在的唯一理由,正是看见它。
 *
 * 真数据库跑(和 admin-identity-truth.test.ts 同样的做法):只有角色门是 mock,
 * Prisma、租户守卫、读模型全部真跑。改成比对源码文本的测试会从这个缺陷上一路绿过去。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("@/lib/auth-guard", () => ({
  requireRole: vi.fn(async () => ({
    email: "founder@fikirtive.test",
    roles: ["super-admin"],
    role: "super-admin",
  })),
  requireOwner: vi.fn(async () => ({ email: "founder@fikirtive.test", ownerId: "founder" })),
}));

const { prisma } = await import("@fikirtive/db");
const { getAdminV2Data } = await import("@/lib/admin-v2");

const TAG = "large-grants";
const ORG_OVER = `org_${TAG}_over`;
/** 在它之后写行的那几个租户 —— 旧写法就是被这些行挤走的。 */
const NOISE_ORGS = [`org_${TAG}_n1`, `org_${TAG}_n2`, `org_${TAG}_n3`];
const OWNER_EMAIL = `${TAG}-owner@example.test`;
const userIds: string[] = [];

/** 超限那家:两笔人工发放,合计 21000 internal = 2100 显示 credits(闸是 2000)。 */
const OVER_INTERNAL = [11_000, 10_000];
const OVER_DISPLAY_TOTAL = 2_100;
/** 噪音:30 行,每行都小,但**都比超限那两行新**。 */
const NOISE_ROWS = 30;

async function makeOrg(id: string, name: string, ownerEmail?: string) {
  await prisma.organization.upsert({ where: { id }, update: {}, create: { id, name } });
  if (!ownerEmail) return;
  const user = await prisma.user.create({ data: { email: ownerEmail, name: ownerEmail, role: "viewer" }, select: { id: true } });
  userIds.push(user.id);
  await prisma.membership.create({
    data: { id: `mem_${TAG}_${user.id}`, userId: user.id, orgId: id, role: "owner", status: "active" },
  });
}

async function ledgerRow(orgId: string, internal: number, minutesAgo: number, seq: number) {
  await prisma.creditLedger.create({
    data: {
      id: `cl_${TAG}_${seq}`,
      orgId,
      balanceDelta: internal,
      reservedDelta: 0,
      kind: "GRANT",
      source: "ADMIN",
      reason: `${TAG} fixture`,
      idempotencyKey: `grant:${TAG}:${seq}`,
      createdBy: "founder@fikirtive.test",
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    },
  });
}

beforeAll(async () => {
  await makeOrg(ORG_OVER, "Over limit shop", OWNER_EMAIL);
  for (const [i, id] of NOISE_ORGS.entries()) await makeOrg(id, `Noise shop ${i + 1}`, `${TAG}-n${i + 1}@example.test`);

  let seq = 0;
  // 先写超限那两行(最旧)。
  for (const internal of OVER_INTERNAL) await ledgerRow(ORG_OVER, internal, 600, seq++);
  // 再写 30 行更新的 —— 全部落在别的租户上。
  for (let i = 0; i < NOISE_ROWS; i += 1) {
    await ledgerRow(NOISE_ORGS[i % NOISE_ORGS.length]!, 100, 30 - i * 0.5, seq++);
  }
});

afterAll(async () => {
  await prisma.creditLedger.deleteMany({ where: { id: { startsWith: `cl_${TAG}_` } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: [ORG_OVER, ...NOISE_ORGS] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_OVER, ...NOISE_ORGS] } } });
});

describe("MONEY-A14 — 超限的 workspace 不会被更新的明细行挤出报表", () => {
  it("前置条件:窗口里最新的 24 行**一行都不是**超限那家的", async () => {
    const newest = await prisma.creditLedger.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
        OR: [
          { source: "ADMIN", kind: { in: ["GRANT", "ADJUST"] } },
          { kind: "RESERVE", refId: { startsWith: "manual-refund:" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { orgId: true },
    });
    expect(newest).toHaveLength(24);
    expect(newest.map((row) => row.orgId)).not.toContain(ORG_OVER);
  });

  it("它照样在表上,而且带的是**累计**、笔数与最近时间,不是某一行的金额", async () => {
    const data = await getAdminV2Data();
    const row = data.largeGrants.find((r) => r.id === ORG_OVER);

    expect(row, "超限的 workspace 必须在表上").toBeTruthy();
    expect(row!.rollingTotal).toBe(OVER_DISPLAY_TOTAL);
    expect(row!.movements).toBe(OVER_INTERNAL.length);
    expect(row!.limit).toBe(2000);
    expect(row!.state).toBe("over limit");
    expect(row!.tenant).toBe("Over limit shop");
    expect(row!.ownerEmail).toBe(OWNER_EMAIL);
    expect(Date.parse(row!.lastAt)).toBeGreaterThan(0);
  });

  it("一行一个 workspace(不再是一行一条明细),超限的排在最前", async () => {
    const data = await getAdminV2Data();
    const ids = data.largeGrants.map((r) => r.id);
    expect(new Set(ids).size, "同一个 org 不能占两行").toBe(ids.length);

    const firstWithin = data.largeGrants.findIndex((r) => r.state === "within limit");
    const overIndex = ids.indexOf(ORG_OVER);
    if (firstWithin !== -1) expect(overIndex).toBeLessThan(firstWithin);
  });

  it("首页那张卡数的是整窗口的超限 workspace,不是表上截过的那 24 行", async () => {
    const data = await getAdminV2Data();
    const signal = data.riskSignals.find((s) => s.id === "large-grants");
    expect(Number(signal!.value)).toBeGreaterThanOrEqual(1);
    // 噪音那三家远在闸下,不能被算进去。
    for (const id of NOISE_ORGS) {
      expect(data.largeGrants.find((r) => r.id === id)?.state).toBe("within limit");
    }
  });
});
