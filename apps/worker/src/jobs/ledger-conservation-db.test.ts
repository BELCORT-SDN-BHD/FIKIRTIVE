/**
 * ledger-conservation-db.test.ts —— **账本守恒探测器**在真库上证(规格 §5 变更登记
 * 2026-09-02 顾问复审⑥;钱引擎⑤B)。
 *
 * 为什么这一族只能打真库:被证的东西**就是一句聚合 SQL 的语义** ——
 *   · `FULL OUTER JOIN` 真的两个方向都抓得到(有账户没流水 / 有流水没账户);
 *   · `SUM(balanceDelta) GROUP BY orgId` 真的按 org 分组,而不是把全平台加成一坨;
 *   · `WHERE balance <> sum` 真的只留下漂移的那些。
 * 这四件事在假库里全部由我自己写的假件决定 —— 那证明的是我的假件。
 *
 * 边界照旧:**只报不补**。每条用例都复核扫描前后余额与账本逐行不变。报警管道是假的,
 * 一封信都不发。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({ founderAlert: vi.fn(), captureMoneyPathError: vi.fn() }));
vi.mock("../alerting.js", () => ({ founderAlert: m.founderAlert, captureMoneyPathError: m.captureMoneyPathError }));

import { prisma, HOLD_SHORTFALL_REASON_PREFIX } from "@fikirtive/db";
import { checkLedgerConservation, findLedgerDrift, sumRecentHoldShortfall } from "./ledger-conservation.js";

// 同其它真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const NOW = new Date("2026-09-02T12:00:00.000Z");
/** 第二天 —— 节流是按 UTC 日算的。 */
const TOMORROW = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 60_000);

/**
 * 用例造的漂移**故意很大**。
 *
 * 这个测试库是跨套件共用的,而别的套件会**合法地**留下一堆看起来像漂移的 org(它们的用例
 * 只跑到半路就断言完了)。实测 2026-09-02:一轮全量之后库里躺着 284 个这样的 org,最大差额
 * 一百万。而巡检按差额大小排序、每轮只报前 CONSERVATION_ALERT_LIMIT 个 —— 一笔 100 credits
 * 的合成漂移会被那 284 个挤出名单,于是用例红的不是代码,是"排队没排上"。
 *
 * 所以合成漂移取一个谁都挤不掉的量级。它不影响被证的东西:排序与截断本来就不是这几条用例
 * 要钉的性质(要钉的是"发现得了 / 报得出 / 只报不补 / 一天一次")。
 */
const HUGE = 1_500_000_000;

/** 这一趟用例自己造的 org(每个用例一批,跑完自己收 —— 库是跨套件共用的)。 */
let mine: string[] = [];

async function seedOrg(balance: number): Promise<string> {
  const orgId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance, reserved: 0 } });
  mine.push(orgId);
  return orgId;
}

async function ledgerRow(orgId: string, over: Partial<{ balanceDelta: number; reservedDelta: number; kind: string; reason: string; createdAt: Date }> = {}) {
  const id = randomUUID();
  await prisma.creditLedger.create({
    data: {
      id,
      orgId,
      balanceDelta: 0,
      reservedDelta: 0,
      kind: "GRANT",
      source: "SYSTEM",
      reason: "",
      idempotencyKey: `t-${id}`,
      ...(over as Record<string, never>),
    },
  });
}

/** 这一轮报警里属于本用例那些 org 的漂移条目。 */
function driftAlertsForMine() {
  return m.founderAlert.mock.calls
    .map((c) => c[0] as { key: string; context: Record<string, unknown> })
    .filter((a) => a.key === "credits.conservation.drift" && mine.includes(String(a.context.orgId)));
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  mine = [];
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 用例自己收摊 —— 这个库跨套件共用,留下的漂移 org 会污染别人的断言。 */
async function cleanup() {
  if (mine.length === 0) return;
  await prisma.actionEvent.deleteMany({ where: { ownerId: { in: mine } } });
  await prisma.creditLedger.deleteMany({ where: { orgId: { in: mine } } });
  await prisma.creditAccount.deleteMany({ where: { orgId: { in: mine } } });
  await prisma.organization.deleteMany({ where: { id: { in: mine } } });
  mine = [];
}

describe("守恒:余额对不上流水就必须有人被叫到", () => {
  it(
    "余额 = Σ balanceDelta ⇒ 一声不吭(否则每一个正常商家都会报警,告警第一天就被无视)",
    async () => {
      const orgId = await seedOrg(100);
      await ledgerRow(orgId, { balanceDelta: 100, kind: "GRANT" });
      try {
        const drift = await findLedgerDrift();
        expect(drift.map((d) => d.orgId)).not.toContain(orgId);

        await checkLedgerConservation(NOW);
        expect(driftAlertsForMine()).toHaveLength(0);
      } finally {
        await cleanup();
      }
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "余额比流水多(有账户没流水)⇒ 报警,带 org 与差额;账本一行不动",
    async () => {
      const orgId = await seedOrg(HUGE); // 有余额、零流水 —— 凭空长出来的钱
      try {
        const before = await prisma.creditLedger.count({ where: { orgId } });
        await checkLedgerConservation(NOW);

        const alerts = driftAlertsForMine();
        expect(alerts).toHaveLength(1);
        expect(alerts[0]!.context).toMatchObject({
          orgId,
          balanceInternal: HUGE,
          ledgerSumInternal: 0,
          driftInternal: HUGE,
        });
        // **只报不补**:余额没被"修好",流水也没被补上一行。
        expect((await prisma.creditAccount.findUniqueOrThrow({ where: { orgId } })).balance).toBe(HUGE);
        expect(await prisma.creditLedger.count({ where: { orgId } })).toBe(before);
      } finally {
        await cleanup();
      }
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "流水比余额多(账户行不见了)⇒ 也报警 —— 这正是 LEFT JOIN 会漏掉的那一半",
    async () => {
      const orgId = `org_${randomUUID()}`;
      await prisma.organization.create({ data: { id: orgId } });
      mine.push(orgId);
      await ledgerRow(orgId, { balanceDelta: HUGE, kind: "GRANT" }); // 有流水,没有 CreditAccount 行
      try {
        const drift = (await findLedgerDrift()).filter((d) => d.orgId === orgId);
        expect(drift).toEqual([{ orgId, balance: 0, ledgerSum: HUGE }]);

        await checkLedgerConservation(NOW);
        expect(driftAlertsForMine()[0]!.context).toMatchObject({ orgId, driftInternal: -HUGE });
      } finally {
        await cleanup();
      }
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "按 org 分组,不是把全平台加成一坨:A 家的多与 B 家的少不许互相抵消",
    async () => {
      const over = await seedOrg(HUGE); // 余额多
      const under = await seedOrg(0);
      await ledgerRow(under, { balanceDelta: HUGE, kind: "GRANT" }); // 流水多(同样大小,方向相反)
      try {
        // 全平台净差恰好是 0 —— 一个不分组的实现在这里会说"一切正常"。
        const drift = (await findLedgerDrift()).filter((d) => mine.includes(d.orgId));
        expect(drift.map((d) => d.orgId).sort()).toEqual([over, under].sort());

        await checkLedgerConservation(NOW);
        expect(driftAlertsForMine()).toHaveLength(2);
      } finally {
        await cleanup();
      }
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "同一个 org 一天只吵一次人:第二轮走 repeat(Sentry 照收),次日重新喊",
    async () => {
      const orgId = await seedOrg(HUGE);
      try {
        await checkLedgerConservation(NOW);
        await checkLedgerConservation(NOW);
        const sameDay = driftAlertsForMine();
        expect(sameDay).toHaveLength(2); // 两次都发了 —— 节流不是静音
        const opts = m.founderAlert.mock.calls
          .filter((c) => (c[0] as { key: string }).key === "credits.conservation.drift")
          .map((c) => c[1]);
        expect(opts[0]).toEqual({ repeat: false }); // 第一次:三通道
        expect(opts[1]).toEqual({ repeat: true }); // 第二次:只有 Sentry

        // 次日:新的一天,重新上膛。一个只响一次的警报器不是警报器。
        m.founderAlert.mockClear();
        await checkLedgerConservation(TOMORROW);
        expect(m.founderAlert.mock.calls.find((c) => (c[0] as { key: string }).key === "credits.conservation.drift")?.[1]).toEqual({
          repeat: false,
        });
      } finally {
        await cleanup();
      }
    },
    DB_CASE_TIMEOUT_MS,
  );
});

describe("hold-shortfall:平台昨天吃掉了多少,必须有人看得见", () => {
  it(
    "过去 24 小时被钳过的 SETTLE 行 ⇒ 数出行数与合计,发一条 info 级报警",
    async () => {
      const orgId = await seedOrg(0);
      try {
        await ledgerRow(orgId, { kind: "SETTLE", reason: `${HOLD_SHORTFALL_REASON_PREFIX}21` });
        await ledgerRow(orgId, { kind: "SETTLE", reason: `${HOLD_SHORTFALL_REASON_PREFIX}4000` });
        // 窗口外的那一行不算(25 小时前)
        await ledgerRow(orgId, {
          kind: "SETTLE",
          reason: `${HOLD_SHORTFALL_REASON_PREFIX}999`,
          createdAt: new Date(Date.now() - 25 * 3_600_000),
        });
        // 没被钳过的普通 SETTLE 也不算
        await ledgerRow(orgId, { kind: "SETTLE", reason: "" });

        const roll = await sumRecentHoldShortfall(new Date());
        // 下界断言:这个库跨套件共用,别人也可能在同一个 24 小时里写下钳行。钉"至少有我这两笔"
        // 是这里唯一诚实的形式 —— 钉等号钉的就是别人的用例有没有在同一秒跑。
        expect(roll.rows).toBeGreaterThanOrEqual(2);
        expect(roll.internal).toBeGreaterThanOrEqual(4021);

        await checkLedgerConservation(new Date());
        const info = m.founderAlert.mock.calls
          .map((c) => c[0] as { key: string; context: Record<string, unknown> })
          .find((a) => a.key === "credits.hold_shortfall.daily");
        expect(info).toBeDefined();
        expect(Number(info!.context.absorbedInternal)).toBeGreaterThanOrEqual(4021);
      } finally {
        await cleanup();
      }
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "窗口真的是一个窗口:24 小时以外的钳行不算,数出来是 0(而 0 不发那条 info)",
    async () => {
      const orgId = await seedOrg(0);
      try {
        await ledgerRow(orgId, { kind: "SETTLE", reason: `${HOLD_SHORTFALL_REASON_PREFIX}77` });
        // 把 now 拨到很久以后 ⇒ 刚写的那一行早就滑出 24 小时窗口。
        // 刻意**不**去删全库的钳行:这个测试库跨套件共用,删掉别人正在断言的行是一个
        // 比"断言不够干净"糟得多的问题。所以改成移动窗口,而不是清空世界。
        const wayLater = new Date(Date.now() + 30 * 24 * 3_600_000);
        const roll = await sumRecentHoldShortfall(wayLater);
        expect(roll).toEqual({ rows: 0, internal: 0 });
        // 而 checkLedgerConservation 在 rows===0 时那条 info 根本不发(见实现的 `if`)。
      } finally {
        await cleanup();
      }
    },
    DB_CASE_TIMEOUT_MS,
  );
});
