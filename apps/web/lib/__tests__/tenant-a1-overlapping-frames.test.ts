/**
 * TENANT-A1 的后半句 ——「**两个商家的请求重叠在飞时互不串帧**」的真并发行为测试。
 *
 * 规格: docs/specs/tenant-isolation.md:51（TENANT-A1，已冻结 · v1，#1369）；里程碑 #1357。
 *
 * 已有的 `tenant-money-frames-slice1.test.ts:149` 只证到**先后**打进来（A 跑完再跑 B），
 * 那条路上 AsyncLocalStorage 就算退化成一个模块级变量也会绿 —— 规格要的「重叠在飞」这一半
 * 因此一直没有被任何测试盯住。这份文件补的就是那一半：
 *
 *  · 两顶帧**同时**在飞：每一顶帧在自己的敏感操作里停在同一个会合点上，只有两边都到齐才放行，
 *    所以「对方正在自己的帧里」是被证明的，不是被假设的；
 *  · 停下来之后各自 await 一次**真实数据库查询**加一次让出（微任务或定时器），让两条链在事件
 *    循环上真正交错；
 *  · 醒来之后再读一次 `getPrincipal()`：进帧那一刻、跨过 await 之后、出帧那一刻三次快照必须
 *    逐字相同 —— 串帧的形状就是这三次读到两个不同的商家；
 *  · 帧内各做一次钱面读（CreditLedger）与一次 gen 面读（GenJob），租户号**只来自帧**，所以
 *    串帧当场变成「读到别家的行」；
 *  · 50 轮，每轮的让出次序由一个**带种子**的伪随机数发生器现摇（不是 Math.random）。
 *
 * 手法沿用切片②（`tenant-action-cross-tenant-slice2.test.ts`）：不 mock `@fikirtive/db`，
 * 真实 Prisma 走真实 `packages/db/src/tenant-guard.ts`，调用的是真实的动作函数
 * （`billing-actions.listCreditPacks` / `gen-actions.getGenJob`）。只 mock 三样与本规格无关的
 * 外部件：会话守卫（`@/lib/auth-guard`）、Stripe、队列/`next/cache`。生产代码零改动、零测试钩子。
 *
 * 注：`billing-actions` 今天一个字都不碰数据库（规格 §1.2 点名它「两处全无帧」时说的也是这件
 * 事：它先缺的是帧，不是查询）。所以钱面那一次真实读是在它自己建的帧**里面**发出的 ——
 * 帧内任何一次未来的账本读会遇到的，正是这里测到的这一套。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { CREDIT_PACKS, CREDIT_PACK_CURRENCY } from "@fikirtive/core";
import type { Principal, UserPrincipal } from "@fikirtive/db/principal";

type Gate = { email: string; ownerId: string };

/**
 * 会话身份的接力棒。
 *
 * 并发下不能再用 `mockResolvedValueOnce` 排队 —— 两条链交错之后「第几次调用」不再对应「哪条
 * 链」。这里改用一根**同步**接力棒：调用方在调用动作函数的同一个同步块里放下自己的会话，而
 * 动作函数的第一句就是 `await requireOwner()`，`requireOwner` 这个假货的函数体在被调用的那一
 * 刻（第一个 await 之前）就把棒子取走。中间没有任何 await，JS 单线程因此保证取到的一定是本条
 * 链刚放下的那一根。取走之后才让出一次，好让两条链连**建帧**这一步都交错。
 */
const h = vi.hoisted(() => {
  const baton: { current: Gate | null } = { current: null };
  const hooks: { yieldNow: () => Promise<void> } = { yieldNow: async () => {} };
  const requireOwner = vi.fn(async (): Promise<Gate> => {
    const gate = baton.current;
    if (!gate) throw new Error("test: requireOwner was called with no gate on the baton");
    await hooks.yieldNow();
    return { ...gate };
  });
  const pricesList = vi.fn();
  return { baton, hooks, requireOwner, pricesList };
});

vi.mock("@/lib/auth-guard", () => ({
  requireOwner: h.requireOwner,
  // 切片①的既有 stub 把 membership 留空，而这条验收要看「userId 也没串」，所以这里给一个
  // 完整的 user 帧：每家店的 subjectUserId / membershipId 都带着自己的 orgId，串帧会当场露馅。
  resolveUserPrincipal: async (gate: Gate): Promise<UserPrincipal> => ({
    kind: "user",
    subjectUserId: `usr_for_${gate.ownerId}`,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: "owner",
    membershipId: `mem_for_${gate.ownerId}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  }),
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: async () => false }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    prices: { list: h.pricesList, retrieve: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn() }));

const { prisma } = await import("@fikirtive/db");
const { getPrincipal, runAsUser, runAsSystem, runAsTenant } = await import("@fikirtive/db/principal");
const { listCreditPacks } = await import("@/lib/billing-actions");
const { getGenJob } = await import("@/lib/gen-actions");

// ── 两家店 ────────────────────────────────────────────────────────────────────
const ORG_A = `org_a1_a_${randomUUID().slice(0, 8)}`;
const ORG_B = `org_a1_b_${randomUUID().slice(0, 8)}`;
const GATE_A: Gate = { email: "aisha@fikirtive.test", ownerId: ORG_A };
const GATE_B: Gate = { email: "bakar@fikirtive.test", ownerId: ORG_B };
const GATE_BY_OWNER: Record<string, Gate> = { [ORG_A]: GATE_A, [ORG_B]: GATE_B };

/** 每家店自己的种子行：gen 面一单，钱面两家行数**故意不同**（3 / 2），串帧连行数都对不上。 */
const genJobId: Record<string, string> = {
  [ORG_A]: `gen_a_${randomUUID().slice(0, 8)}`,
  [ORG_B]: `gen_b_${randomUUID().slice(0, 8)}`,
};
const projectId: Record<string, string> = {
  [ORG_A]: `proj_a_${randomUUID().slice(0, 8)}`,
  [ORG_B]: `proj_b_${randomUUID().slice(0, 8)}`,
};
const ledgerIds: Record<string, string[]> = { [ORG_A]: [], [ORG_B]: [] };

/** Stripe 的假货货架 —— 逐行照 `CREDIT_PACKS` 生成，动作因此真的跑到底、返回三个包。 */
const STRIPE_PRICES = CREDIT_PACKS.map((pack, index) => ({
  id: `price_a1_${index}`,
  active: true,
  unit_amount: pack.amountMinor,
  currency: CREDIT_PACK_CURRENCY,
  metadata: { credits: String(pack.credits) },
}));

// ── 带种子的伪随机数（每条链每一轮一台，所以交错次序与调度无关，可复现） ──────────
/** 种子固定在文件里，取自这条验收的两张票（#1369 / #1357）。刻意不用 Math.random。 */
const SEED = 13691357;
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 一次让出：一半几率走微任务（让出但不进定时器队列），一半几率走 0–2ms 的真定时器。 */
async function randomYield(rng: () => number): Promise<void> {
  if (rng() < 0.5) {
    const rounds = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
    return;
  }
  const ms = Math.floor(rng() * 3);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** 两方会合点：两边都到齐才一起放行 —— 「对方正在自己的帧里」由它证明。 */
function rendezvous(parties: number): () => Promise<void> {
  let pending = parties;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    pending -= 1;
    if (pending <= 0) release();
    await open;
  };
}

// ── 帧快照 ────────────────────────────────────────────────────────────────────
type Snapshot = {
  kind: string | undefined;
  ownerId: string | null;
  subjectUserId: string | null;
  subjectEmail: string | null;
};

function snapshot(): Snapshot {
  const principal: Principal | undefined = getPrincipal();
  if (!principal) return { kind: undefined, ownerId: null, subjectUserId: null, subjectEmail: null };
  if (principal.kind === "user") {
    return {
      kind: principal.kind,
      ownerId: principal.ownerId,
      subjectUserId: principal.subjectUserId,
      subjectEmail: principal.subjectEmail,
    };
  }
  return {
    kind: principal.kind,
    ownerId: "ownerId" in principal ? principal.ownerId ?? null : null,
    subjectUserId: null,
    subjectEmail: null,
  };
}

/** 一次帧内探针留下的全部证据。 */
type FrameLog = {
  entry: Snapshot;
  afterDb: Snapshot;
  exit: Snapshot;
  ledgerOrgIds: string[];
  ledgerIds: string[];
  genJobIds: string[];
  genJobOwnerIds: string[];
};

type Round = {
  moneyGate: () => Promise<void>;
  genGate: () => Promise<void>;
  genArrived: Set<string>;
  rngByOwner: Record<string, () => number>;
  moneyLogs: FrameLog[];
  genLogs: Array<{ entry: Snapshot; afterYield: Snapshot; exit: Snapshot }>;
};

let round: Round;

function rngFor(ownerId: string | null): () => number {
  const rng = ownerId ? round?.rngByOwner[ownerId] : undefined;
  // 串帧时探针会摸到另一条链的发生器 —— 那不影响判定（判定看的是帧本身），但绝不能因此炸掉。
  return rng ?? mulberry32(SEED);
}

// ── 种子数据 ──────────────────────────────────────────────────────────────────
beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_tenant_a1_overlap";
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }], skipDuplicates: true });
  for (const [ownerId, rows] of [
    [ORG_A, 3],
    [ORG_B, 2],
  ] as Array<[string, number]>) {
    await prisma.creditAccount.create({ data: { orgId: ownerId, balance: 100 * rows, reserved: 0 } });
    await prisma.project.create({ data: { id: projectId[ownerId], ownerId, name: `${ownerId} project` } });
    await prisma.genJob.create({
      data: {
        id: genJobId[ownerId],
        ownerId,
        projectId: projectId[ownerId],
        prompt: `poster for ${ownerId}`,
        model: "seedream",
        status: "DONE",
      },
    });
    for (let i = 0; i < rows; i += 1) {
      const id = `led_${ownerId}_${i}`;
      ledgerIds[ownerId].push(id);
      await prisma.creditLedger.create({
        data: {
          id,
          orgId: ownerId,
          balanceDelta: 10,
          reservedDelta: 0,
          kind: "GRANT",
          idempotencyKey: `grant:${id}`,
        },
      });
    }
    ledgerIds[ownerId].sort();
  }
});

afterAll(async () => {
  // 清场一律在**点了名的租户帧**里做（切片②同一条口径）：不带租户的系统帧写受守卫的表，
  // `ownerId` 族当场抛、钱表族在观察挡位下只是 warn —— 两种都不该出现在清场路径上。
  for (const ownerId of [ORG_A, ORG_B]) {
    await runAsTenant(ownerId, () => prisma.creditLedger.deleteMany({ where: { orgId: ownerId } }));
    await runAsTenant(ownerId, () => prisma.creditAccount.deleteMany({ where: { orgId: ownerId } }));
    await runAsTenant(ownerId, () => prisma.genJob.deleteMany({ where: { ownerId } }));
    await runAsTenant(ownerId, () => prisma.project.deleteMany({ where: { ownerId } }));
  }
  await runAsSystem("test-seed", () =>
    prisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } }),
  );
});

beforeEach(() => {
  h.baton.current = null;
  h.hooks.yieldNow = async () => {
    await randomYield(rngFor(snapshot().ownerId));
  };
  // 钱面探针：它在 `listCreditPacks` 自己用 runAsUser 建的那顶帧**里面**执行。
  h.pricesList.mockImplementation(async () => {
    const entry = snapshot();
    const rng = rngFor(entry.ownerId);
    await round.moneyGate(); // ← 两顶帧都到齐才继续：对方此刻确实在它自己的帧里
    await randomYield(rng);
    // 钱面读。钱两表今天走观察挡位（warn，tenant-guard.ts:118），守卫不替它注入 orgId ——
    // 所以租户号只能来自帧，串帧当场读成别家的流水。
    const ledger = await prisma.creditLedger.findMany({
      where: { orgId: snapshot().ownerId ?? "" },
      select: { id: true, orgId: true },
    });
    const afterDb = snapshot();
    await randomYield(rng);
    // gen 面读。GenJob 属 `ownerId` 族（恒为 enforce），这一句**不带任何 where** ——
    // 回来的行全部由守卫从环境帧里注入的租户号决定，是「只读得到自己」最直接的一次演示。
    const jobs = await prisma.genJob.findMany({ select: { id: true, ownerId: true } });
    round.moneyLogs.push({
      entry,
      afterDb,
      exit: snapshot(),
      ledgerOrgIds: [...new Set(ledger.map((row) => row.orgId))].sort(),
      ledgerIds: ledger.map((row) => row.id).sort(),
      genJobIds: jobs.map((row) => row.id).sort(),
      genJobOwnerIds: [...new Set(jobs.map((row) => row.ownerId))].sort(),
    });
    return { data: STRIPE_PRICES };
  });
});

describe("TENANT-A1「两个商家的请求重叠在飞时互不串帧」", () => {
  it(
    "TENANT-A1 50 轮真并发：两顶帧同时在飞、跨过真实查询与让出之后，各自仍然只认自己的身份与自己的行",
    async () => {
      const originalGenJobFindFirst = prisma.genJob.findFirst.bind(prisma.genJob) as (
        ...args: unknown[]
      ) => unknown;
      // gen 面探针。与切片②同一条注记：还原用手动赋值而不是 `spy.mockRestore()`
      // （对这个 Prisma delegate，mockRestore 之后属性会变成 undefined 而不是原方法）。
      vi.spyOn(prisma.genJob, "findFirst").mockImplementation(((...args: unknown[]) => {
        const entry = snapshot();
        const owner = entry.ownerId;
        return (async () => {
          // 每条链每一轮只在这里会合一次（第二次读的是别家的 id，不再会合，免得放行少一方）。
          if (owner && !round.genArrived.has(owner)) {
            round.genArrived.add(owner);
            await round.genGate();
          }
          await randomYield(rngFor(owner));
          const afterYield = snapshot();
          const rows = await originalGenJobFindFirst(...args);
          round.genLogs.push({ entry, afterYield, exit: snapshot() });
          return rows;
        })();
      }) as never);

      try {
        for (let i = 0; i < 50; i += 1) {
          round = {
            moneyGate: rendezvous(2),
            genGate: rendezvous(2),
            genArrived: new Set<string>(),
            rngByOwner: { [ORG_A]: mulberry32(SEED + i * 2 + 1), [ORG_B]: mulberry32(SEED + i * 2 + 2) },
            moneyLogs: [],
            genLogs: [],
          };
          const orderRng = mulberry32(SEED - i - 1);
          const order: Gate[] = orderRng() < 0.5 ? [GATE_A, GATE_B] : [GATE_B, GATE_A];

          // 两条链**同时**起飞：同一个同步块里各自放下自己的接力棒并进入动作函数。
          const results = await Promise.all(order.map((gate) => runMerchantChain(gate)));

          // ① 两条链各自拿回自己的东西（这一半的身份来自链外，不来自帧 —— 串帧骗不过它）
          for (let k = 0; k < order.length; k += 1) {
            const gate = order[k];
            const result = results[k];
            expect("packs" in result.shelf && result.shelf.packs.length, `第 ${i} 轮 ${gate.ownerId} 的货架`).toBe(
              CREDIT_PACKS.length,
            );
            expect(result.own?.id, `第 ${i} 轮 ${gate.ownerId} 读自己的那一单`).toBe(genJobId[gate.ownerId]);
            expect(result.foreign, `第 ${i} 轮 ${gate.ownerId} 读别家的那一单`).toBeNull();
          }

          // ② 钱面帧内探针：两顶帧、两个商家，各自三次快照逐字相同，行只读得到自己的
          expect(round.moneyLogs, `第 ${i} 轮钱面帧数`).toHaveLength(2);
          expect(
            round.moneyLogs.map((log) => log.entry.ownerId).sort(),
            `第 ${i} 轮钱面两顶帧的店`,
          ).toEqual([ORG_A, ORG_B].sort());
          for (const log of round.moneyLogs) {
            const owner = log.entry.ownerId ?? "";
            const gate = GATE_BY_OWNER[owner];
            expect(gate, `第 ${i} 轮出现了一顶不属于任何一家店的帧: ${owner}`).toBeDefined();
            expect(log.entry).toEqual({
              kind: "user",
              ownerId: owner,
              subjectUserId: `usr_for_${owner}`,
              subjectEmail: gate.email,
            });
            // 串帧的形状就是这两句不相等：跨过会合点、真实查询与让出之后帧换了一家店。
            expect(log.afterDb, `第 ${i} 轮 ${owner} 跨过真实查询之后帧变了`).toEqual(log.entry);
            expect(log.exit, `第 ${i} 轮 ${owner} 出帧时帧变了`).toEqual(log.entry);
            expect(log.ledgerOrgIds, `第 ${i} 轮 ${owner} 读到了别家的流水`).toEqual([owner]);
            expect(log.ledgerIds, `第 ${i} 轮 ${owner} 的流水行`).toEqual(ledgerIds[owner]);
            expect(log.genJobOwnerIds, `第 ${i} 轮 ${owner} 的受闸读串了店`).toEqual([owner]);
            expect(log.genJobIds, `第 ${i} 轮 ${owner} 的受闸读串了行`).toEqual([genJobId[owner]]);
          }

          // ③ gen 面帧内探针：每轮四次（两条链各读自己一次、读别家一次），三次快照同样逐字相同
          expect(round.genLogs, `第 ${i} 轮 gen 面帧数`).toHaveLength(4);
          for (const log of round.genLogs) {
            const owner = log.entry.ownerId ?? "";
            expect(GATE_BY_OWNER[owner], `第 ${i} 轮 gen 面出现了陌生的店: ${owner}`).toBeDefined();
            expect(log.entry.kind).toBe("user");
            expect(log.entry.subjectUserId).toBe(`usr_for_${owner}`);
            expect(log.afterYield, `第 ${i} 轮 ${owner} 让出之后 gen 帧变了`).toEqual(log.entry);
            expect(log.exit, `第 ${i} 轮 ${owner} gen 查询之后帧变了`).toEqual(log.entry);
          }
        }
      } finally {
        prisma.genJob.findFirst = originalGenJobFindFirst as never;
      }
    },
    180_000,
  );

  it("TENANT-A1 反证（无帧即拒 + 帧决定行）：同样两句读拿掉帧就被守卫当场拒绝，换一顶帧就换一批行", async () => {
    // ① 帧外：什么都没有
    expect(getPrincipal()).toBeUndefined();

    // ② 上面那条测里「不带 where 的受闸读」放到帧外 —— 守卫直接拒（规格 §1.3 第四态「无帧＝拒」）
    await expect(prisma.genJob.findMany({ select: { id: true } })).rejects.toThrow(
      /GenJob\.findMany has no ownerId filter/,
    );
    // 连动作函数自己那一句（按 id 读）拿掉 ownerId 也是拒：拦住的是守卫，不是动作层的显式过滤
    await expect(prisma.genJob.findFirst({ where: { id: genJobId[ORG_A] } })).rejects.toThrow(
      /GenJob\.findFirst has no ownerId filter/,
    );

    // ③ 钱面：帧丢了以后那句读会读成什么样 —— 两家店的流水一起回来（库里还有别的租户就一起回
    //    来得更多，那正是「无帧＝读穿全库」的样子）。钱两表今天是观察挡位（warn），所以这里不是
    //    抛错而是读穿；enforce 下同一句是拒，那一半由
    //    packages/db/src/tenant-guard-money-slice1.test.ts:133 证。两种挡位下结论一样：
    //    上面那条并发测里的「只读得到自己」不是恒真句，它真的分得出串没串帧。
    const leaked = await prisma.creditLedger.findMany({
      where: { orgId: undefined },
      select: { orgId: true },
    });
    expect([...new Set(leaked.map((row) => row.orgId))]).toEqual(expect.arrayContaining([ORG_A, ORG_B]));

    // ④ 帧决定行：同一句受闸读，换一顶帧就换一批行
    const asA = await runAsUser(principalFor(GATE_A), () => prisma.genJob.findMany({ select: { id: true } }));
    const asB = await runAsUser(principalFor(GATE_B), () => prisma.genJob.findMany({ select: { id: true } }));
    expect(asA.map((row) => row.id)).toEqual([genJobId[ORG_A]]);
    expect(asB.map((row) => row.id)).toEqual([genJobId[ORG_B]]);
  });
});

/** 一条商家链：货架（钱面）→ 读自己的那一单 → 读别家的那一单。 */
async function runMerchantChain(gate: Gate): Promise<{
  shelf: Awaited<ReturnType<typeof listCreditPacks>>;
  own: Awaited<ReturnType<typeof getGenJob>>;
  foreign: Awaited<ReturnType<typeof getGenJob>>;
}> {
  const other = gate.ownerId === ORG_A ? ORG_B : ORG_A;
  const shelf = await withGate(gate, () => listCreditPacks());
  const own = await withGate(gate, () => getGenJob(genJobId[gate.ownerId]));
  const foreign = await withGate(gate, () => getGenJob(genJobId[other]));
  return { shelf, own, foreign };
}

/**
 * 放下接力棒并立刻进入动作函数 —— 中间**没有** await，所以 `requireOwner` 取到的一定是这一根。
 * 这正是真实请求里的形状：会话是请求自带的，不是按调用次序排队发的。
 */
function withGate<T>(gate: Gate, call: () => Promise<T>): Promise<T> {
  h.baton.current = gate;
  return call();
}

function principalFor(gate: Gate): UserPrincipal {
  return {
    kind: "user",
    subjectUserId: `usr_for_${gate.ownerId}`,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: "owner",
    membershipId: `mem_for_${gate.ownerId}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  };
}
