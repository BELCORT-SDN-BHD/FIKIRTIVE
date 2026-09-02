/**
 * creation-routing-ledger —— 能力路由与 SKU 白名单的**全真账本**证据。
 *
 * 规格 docs/specs/creation-engine.md,验收 CREATE-A4 / CREATE-A5 / CREATE-A6。
 *
 * 真 Postgres(*_test)、真 Prisma、真 credit ledger(经真 `startGen` 的 `reserveCredits`),
 * worker 的结算走它自己那个函数(`settleCredits`)原样模拟 —— 零真实 provider 调用、
 * 零真实花费。只有 startGen 周边的 web 管线是替身(auth guard / impersonation / queue /
 * guardian / model registry / next-cache),与 `factory-batch-ledger.test.ts` 同一套。
 *
 * 纯判据(路由挑哪一格、白名单放不放行、价目表有没有条目)在
 * `packages/core/src/creation-routing.test.ts`;这里只证账本上真的发生了什么:
 *   · CREATE-A4:商家要 1080p ⇒ 落到高清槽位,前置报价 == `reserve:<refId>` 绝对值
 *     == `settle:<refId>` 绝对值 == 55 显示 credits;落库的路由理由可查、无型号名;
 *   · CREATE-A5 / CREATE-A6:白名单外的请求 ⇒ 拒绝,**ledger 零新增行**、零 GenJob。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, routeReasonFor } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { startCanvasGen } = await import("../gen-actions");
const { prisma, settleCredits } = await import("@fikirtive/db");

/** 1080p 5 秒 = 11cr/秒 × 5 = 55 显示 credits(Founder 2026-09-02 追认,规格 §5)。 */
const HD_5S_DISPLAY = 55;

async function seedWorld(balanceDisplay: number) {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({
    data: { orgId: ownerId, balance: balanceDisplay * INTERNAL_PER_DISPLAY, reserved: 0 },
  });
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Creation routing" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, projectId };
}

async function ledgerRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}

/** worker 的成功结算,走它自己那个函数(不传 actualInternal ⇒ 全额落账)。 */
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({
    where: { id: jobId, ownerId },
    data: { status: "DONE", spent: true, finishedAt: new Date() },
  });
}

/** 商家在画布上按下生成的那一份请求 —— **只说能力**(要 1080p),不说型号。 */
function canvasRequest(
  world: { projectId: string },
  over: Record<string, unknown> = {},
) {
  return {
    actionId: `act-${randomUUID()}`,
    expectedCredits: HD_5S_DISPLAY,
    projectId: world.projectId,
    prompt: "a slow push-in on the product on a marble counter",
    count: 1,
    kind: "video",
    // 商家的浏览器送的是**能力别名**,不是引擎名(gen-actions 的 publicModelAlias)。
    model: "capability-video-1",
    resolution: "1080p",
    durationSeconds: 5,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("CREATE-A4 商家要 1080p:路由到高清档,报价 == reserve == settle,理由可查", () => {
  it("CREATE-A4 前置报价 55cr == ledger reserve 绝对值 == settle 绝对值", async () => {
    const world = await seedWorld(500);
    // ① 前置报价:请求带着商家屏幕上那个数字(`expectedCredits`)。服务端自己算一遍,
    //    对不上就在 create/reserve 之前拒 —— 所以这一单能成功,本身就是「报价 == 扣款」。
    const started = await startCanvasGen(canvasRequest(world));
    expect(started, JSON.stringify(started)).toHaveProperty("id");
    const jobId = (started as { id: string }).id;

    // ② 落库的那一行确实走了**高清槽位**(路由生效),而请求里一个引擎名都没出现过。
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: world.ownerId } });
    expect(job.model).toBe("seedance-2-0");
    expect((job.videoOptions as { resolution?: string }).resolution).toBe("1080p");

    // ③ reserve 的绝对值。
    const afterReserve = await ledgerRows(world.ownerId);
    const reserve = afterReserve.find((r) => r.idempotencyKey === `reserve:${jobId}`);
    expect(reserve, "没有 reserve 行").toBeDefined();
    expect(Math.abs(reserve!.balanceDelta)).toBe(HD_5S_DISPLAY * INTERNAL_PER_DISPLAY);
    expect(Math.abs(reserve!.reservedDelta)).toBe(HD_5S_DISPLAY * INTERNAL_PER_DISPLAY);

    // ④ settle 的绝对值 —— worker 自己那个函数落的账。
    await workerSettle(world.ownerId, jobId);
    const afterSettle = await ledgerRows(world.ownerId);
    const settle = afterSettle.find((r) => r.idempotencyKey === `settle:${jobId}`);
    expect(settle, "没有 settle 行").toBeDefined();
    expect(Math.abs(settle!.reservedDelta)).toBe(HD_5S_DISPLAY * INTERNAL_PER_DISPLAY);
    // 三处一致,一格不差。
    expect(Math.abs(settle!.reservedDelta)).toBe(Math.abs(reserve!.reservedDelta));
    const acct = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: world.ownerId } });
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe((500 - HD_5S_DISPLAY) * INTERNAL_PER_DISPLAY);
  });

  it("CREATE-A4 报价对不上就在 reserve 之前拒:ledger 零新增行", async () => {
    const world = await seedWorld(500);
    // 商家屏幕上写的是默认档的价,请求要的却是高清档 —— 「按旧价签字、按新价扣款」正是
    // 这道闸挡的那件事。
    const refused = await startCanvasGen(canvasRequest(world, { expectedCredits: 11 }));
    expect(refused).toHaveProperty("error");
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
  });

  it("CREATE-A4 路由理由:落 Generation 的那一句可查,而且只写能力名词", async () => {
    const world = await seedWorld(500);
    const started = await startCanvasGen(canvasRequest(world));
    const jobId = (started as { id: string }).id;
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: world.ownerId } });

    // worker 建 Generation 行时写的就是这一句(输入只有已冻结的 job 行)。这里用同一个
    // 纯函数算出它,再原样落一行 Generation —— 证的是「这一列真的存得下、读得出」。
    const routeReason = routeReasonFor({
      kind: "video",
      model: job.model,
      resolution: (job.videoOptions as { resolution?: string }).resolution ?? null,
    });
    expect(routeReason).toBe("You asked for 1080p, so this went to the HD tier.");
    for (const secret of ["seedance", "seedream", "dreamina", "byteplus", "mini"]) {
      expect(routeReason!.toLowerCase()).not.toContain(secret);
    }

    const assetId = `ast_${randomUUID()}`;
    await prisma.asset.create({
      data: {
        id: assetId, ownerId: world.ownerId, contentHash: randomUUID().replace(/-/gu, ""),
        ext: "mp4", mime: "video/mp4", sizeBytes: BigInt(1), originalFilename: "clip.mp4", source: "GENERATED",
      },
    });
    const genId = `gen_${randomUUID()}`;
    await prisma.generation.create({
      data: {
        id: genId, ownerId: world.ownerId, projectId: world.projectId, assetId,
        source: "GENERATED", promptText: job.prompt, modelRef: job.model,
        routeReason, entitySnapshot: { entities: [] }, version: 1,
      },
    });
    const stored = await prisma.generation.findFirstOrThrow({ where: { id: genId, ownerId: world.ownerId } });
    expect(stored.routeReason).toBe(routeReason);
  });
});

describe("CREATE-A5 直接请求未定价的档:拒绝、ledger 零新增行、不是降级", () => {
  /**
   * 口径说明(不含糊其辞):付费入口上有**两道**闸,这一节量的是「商家真的从这条路请求
   * 一个没有价的档会发生什么」,而不是哪一道闸先开口。
   *   ① 契约闸(`genRequest` 的 superRefine):档位不在路由到的那个槽位的能力表上;
   *   ② 付费闸(`assertSpendableModel` 的 SKU 白名单):档位在能力表上却没有价。
   * ② 的**直接**演示(高清槽位的 720p)在 `packages/core/src/creation-routing.test.ts`
   * ——它不经这条请求路,因为路由器按分辨率把槽位定死了(720p 永远落默认档),
   * 于是从这条路根本构造不出「槽位×档位」不匹配的请求。那是**设计意图**:
   * 商家面上不存在挑引擎这件事,能挑的只有能力。
   * 两条测试合起来才是 A5 的全部:请求路拒得掉,闸本身也拒得掉。
   */
  it("CREATE-A5 请求一个没有价的画质 ⇒ 拒绝、零账本行、零任务、**不降级到别的档**", async () => {
    const world = await seedWorld(500);
    // 4K 是 S2 §8.1① 明写「不卖」的那一档:高清槽位的能力表上没有它,价目表上更没有。
    const refused = await startCanvasGen(canvasRequest(world, { resolution: "4K", expectedCredits: 55 }));
    expect(refused).toHaveProperty("error");
    // 零新增行、零任务 —— 两道闸都站在 pricedGenCredits 与 reserveCredits 之前。
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // **不是降级**:没有任何一行落在别的档上(降级会留下一条 720p 的任务并扣 11cr)。
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId, model: "seedance-2-mini" } })).toBe(0);
    const acct = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: world.ownerId } });
    expect(acct.balance).toBe(500 * INTERNAL_PER_DISPLAY);
    expect(acct.reserved).toBe(0);
  });

  it("CREATE-A5 档外秒数同样拒:价格只定义在已裁过的那些格上", async () => {
    const world = await seedWorld(500);
    const refused = await startCanvasGen(canvasRequest(world, { durationSeconds: 3, expectedCredits: 33 }));
    expect(refused).toHaveProperty("error");
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
  });

  it("CREATE-A5 默认档 env 配错走的是**另一条**出路:降级 + 留日志,不是拒绝", async () => {
    // 这半条验收是纯函数判据(env → 用哪个槽位),证据在
    // packages/core/src/creation-routing.test.ts 的同名用例:配错 ⇒ 回落白名单内的默认档
    // 并 console.warn。放在这里的只有一句口径:**降级只发生在我们自己配错的时候**,
    // 商家直接请求一个没有价的档,永远只能被如实拒绝(上面两条)。
    const world = await seedWorld(500);
    const ok = await startCanvasGen(canvasRequest(world));
    expect(ok).toHaveProperty("id");
    const job = await prisma.genJob.findFirstOrThrow({ where: { ownerId: world.ownerId } });
    expect(job.model).toBe("seedance-2-0");
  });
});

describe("CREATE-A6 图片侧同形:未定价的 pro 变体拒绝 $0;pro 标准图已定价可售", () => {
  it("CREATE-A6 pro 标准图 2cr/张:真扣 2cr,reserve == settle", async () => {
    const world = await seedWorld(50);
    const started = await startCanvasGen({
      actionId: `act-${randomUUID()}`,
      expectedCredits: 2,
      projectId: world.projectId,
      prompt: "the bottle on a transparent background",
      count: 1,
      kind: "image",
      model: "capability-image-2", // 菜单第二格 = pro 槽位
    });
    expect(started, JSON.stringify(started)).toHaveProperty("id");
    const jobId = (started as { id: string }).id;
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: world.ownerId } });
    expect(job.model).toBe("seedream-pro");

    const reserve = (await ledgerRows(world.ownerId)).find((r) => r.idempotencyKey === `reserve:${jobId}`);
    expect(Math.abs(reserve!.balanceDelta)).toBe(2 * INTERNAL_PER_DISPLAY);
    await workerSettle(world.ownerId, jobId);
    const settle = (await ledgerRows(world.ownerId)).find((r) => r.idempotencyKey === `settle:${jobId}`);
    expect(Math.abs(settle!.reservedDelta)).toBe(2 * INTERNAL_PER_DISPLAY);

    // lite 一格没动:同一份请求走默认槽位仍是 1cr。
    const lite = await startCanvasGen({
      actionId: `act-${randomUUID()}`,
      expectedCredits: 1,
      projectId: world.projectId,
      prompt: "the bottle on a marble counter",
      count: 1,
      kind: "image",
      model: "capability-image-1",
    });
    expect(lite).toHaveProperty("id");
  });

  it("CREATE-A6 商家屏幕上若写着 lite 的价却点了 pro ⇒ 拒绝、$0(报价即授权)", async () => {
    const world = await seedWorld(50);
    const refused = await startCanvasGen({
      actionId: `act-${randomUUID()}`,
      expectedCredits: 1, // lite 的价
      projectId: world.projectId,
      prompt: "the bottle on a transparent background",
      count: 1,
      kind: "image",
      model: "capability-image-2", // 却是 pro 槽位
    });
    expect(refused).toHaveProperty("error");
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
  });
});
