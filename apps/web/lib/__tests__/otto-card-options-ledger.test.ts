/**
 * otto-card-options-ledger —— 商家**在确认卡上**改张数／形状／精修,钱路的全真账本证据。
 *
 * 规格 docs/specs/otto-engine.md,验收 ENGINE-A3(§5 登记 2026-09-05,Founder 裁决
 * 「加进确认卡」)。⑦段退役直出 composer 之后,这张卡是唯一的花钱入口,所以「批准前
 * 可改」这件事的钱路必须自己有证据。
 *
 * 纯判词(谁改得动、改完卡上是什么、价从哪来)钉在
 * `packages/otto/src/skills/propose-card-options.test.ts`;这一份只证**账本上真的发生了
 * 什么**:
 *   · 卡上改一格 ⇒ 卡面报价换了一个数,而 `reserve:<jobId>` 的绝对值**等于卡上那个数**;
 *   · 变异证据:把卡上的价钉死在旧值(预扣不随卡变)⇒ 付费路在 create/reserve **之前**拒,
 *     ledger 零新增行 —— 这一条就是「报价与预扣同源」那句话的反证;
 *   · 已经在跑的卡改不动;跨租户改不动(卡一个字节不动);
 *   · 已经成交的卡改不动 —— 画布那张回执卡(`canvasAction`)与卡上已挂任务行的卡
 *     (`genJobId`)都拒在任何写之前,payload 一个字节不动、账本零新增行(#1239 判官 P2-1)。
 *
 * 真 Postgres(*_test)、真 Prisma、真 credit ledger(经真 `startCoworkGen` → `startGen` 的
 * `reserveCredits`),worker 的结算走它自己那个函数原样模拟 —— 零真实 provider 调用、
 * 零真实花费。替身只有 startGen 周边的 web 管线,与 `otto-resolution-tier-ledger.test.ts`
 * 同一套。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_IMAGE_MODEL,
  PRO_IMAGE_MODEL,
  GEN_IMAGE_MODEL_OPTIONS,
  INTERNAL_PER_DISPLAY,
  buildGenRequestFromCard,
  imageAspectHonoured,
  isSellableImageSku,
} from "@fikirtive/core";
import { buildProposeCard, type CardPayload, type OttoContext } from "@fikirtive/otto";

const mockRequireOwner = vi.fn();
// 身份帧默认走真夹具(与 requireOwner 同一个租户);只有那条「拆掉应用层闸就红」的用例
// 临时把它换成一个**无租户的系统帧**,好把底下那道 Prisma 租户守卫让开。
const mockResolveUserPrincipal = vi.fn();
vi.mock("@/lib/auth-guard", () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (...args: unknown[]) => mockResolveUserPrincipal(...args),
}));
const { stubResolveUserPrincipal } = await import("@/lib/__tests__/__stubs__/resolve-user-principal");
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { checkCast: mockCheckCast } = await import("../cowork-guardian");
const { buildCanvasPaidCardPayload } = await import("../canvas-thread-log");
const { startCoworkGen } = await import("../gen-actions");
const { ottoUpdateGenCardOptions } = await import("../otto-actions");
const { prisma, settleCredits } = await import("@fikirtive/db");

const PROMPT = "A pandan kaya jar on a marble counter";

function ottoCtx(world: { ownerId: string; projectId: string; threadId: string }): OttoContext {
  return {
    orgId: world.ownerId,
    userId: "user-test",
    projectId: world.projectId,
    threadId: world.threadId,
    disabledModels: [],
    sourceGenerationId: null,
  } as OttoContext;
}

async function seedWorld(balanceDisplay: number) {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({
    data: { orgId: ownerId, balance: balanceDisplay * INTERNAL_PER_DISPLAY, reserved: 0 },
  });
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Otto card options" } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, projectId, threadId };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

/** Otto 铸卡 → 原样落库成一张 GEN_CARD(payload 一个字节都不改写)。 */
async function mintImageCard(world: World, seq = 1): Promise<{ cardId: string; payload: CardPayload }> {
  const { cardPayload } = buildProposeCard(
    { kind: "image", structuredPrompt: PROMPT, entityIds: [], variantSel: {} },
    ottoCtx(world),
    [],
  );
  const cardId = `msg_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId: world.threadId,
      ownerId: world.ownerId,
      role: "AGENT",
      kind: "GEN_CARD",
      seq,
      text: "",
      payload: cardPayload as unknown as object,
    },
  });
  return { cardId, payload: cardPayload };
}

/** 库里那张卡此刻长什么样 —— 商家批准时 `startCoworkGen` 读回来的正是它。 */
async function persistedCard(world: World, cardId: string): Promise<CardPayload> {
  const row = await prisma.chatMessage.findFirstOrThrow({
    where: { id: cardId, ownerId: world.ownerId, kind: "GEN_CARD" },
    select: { payload: true },
  });
  return row.payload as unknown as CardPayload;
}

/** 商家按下确认的那一刻:卡 → 付费请求(与 `plan-approval` 走的是同一个纯装配器)。 */
async function approve(world: World, cardId: string, payload: CardPayload) {
  const built = buildGenRequestFromCard({
    cardPayload: payload,
    projectId: world.projectId,
    threadId: world.threadId,
    cardId,
    entityIds: payload.entityIds,
    variantSel: payload.variantSel,
  });
  if (!built.ok) throw new Error(`卡装不成付费请求:${built.error}`);
  return { req: built.req, result: await startCoworkGen(built.req) };
}

async function ledgerRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}

async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({
    where: { id: jobId, ownerId },
    data: { status: "DONE", spent: true, finishedAt: new Date() },
  });
}

function jobIdOf(result: Awaited<ReturnType<typeof startCoworkGen>>): string {
  if ("error" in result) throw new Error(`startCoworkGen 失败:${result.error}`);
  return result.id;
}

function updatedPayload(result: Awaited<ReturnType<typeof ottoUpdateGenCardOptions>>): CardPayload {
  if ("error" in result) throw new Error(`改档被拒:${result.error}`);
  return result.payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveUserPrincipal.mockImplementation(stubResolveUserPrincipal as never);
});

describe("ENGINE-A3 商家在确认卡上改三格,一路走到账本", () => {
  it("ENGINE-A3 改张数:卡面报价换了个数,预扣 == 卡上那个数,结算同额", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const before = card.payload.estimatedCredits;

    const after = updatedPayload(
      await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 3 }),
    );
    expect(after.params.count).toBe(3);
    expect(after.estimatedCredits).toBeGreaterThan(before);
    // 库里那一份就是商家批准时会被读回来的那一份 —— 不是内存里的副本。
    expect((await persistedCard(world, card.cardId)).estimatedCredits).toBe(after.estimatedCredits);

    const jobId = jobIdOf((await approve(world, card.cardId, await persistedCard(world, card.cardId))).result);
    const rows = await ledgerRows(world.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("RESERVE");
    expect(Math.abs(rows[0]!.balanceDelta)).toBe(after.estimatedCredits * INTERNAL_PER_DISPLAY);

    // 任务行冻的张数就是卡上那个数。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: jobId, ownerId: world.ownerId },
      select: { count: true, model: true, idempotencyKey: true },
    });
    expect(job.count).toBe(3);
    expect(job.idempotencyKey).toBe(`cowork:${card.cardId}`);

    await workerSettle(world.ownerId, jobId);
    const settled = await ledgerRows(world.ownerId);
    expect(settled.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expect(Math.abs(settled[1]!.reservedDelta)).toBe(after.estimatedCredits * INTERNAL_PER_DISPLAY);
  });

  it("ENGINE-A3 勾精修:卡换到那一档、按那一档报价,预扣 == 卡上那个数、任务行落的是那一档", async () => {
    if (!isSellableImageSku(PRO_IMAGE_MODEL)) return;
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    expect(card.payload.model).toBe(DEFAULT_IMAGE_MODEL);

    const fine = updatedPayload(
      await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, fineDetail: true }),
    );
    expect(fine.model).toBe(PRO_IMAGE_MODEL);
    expect(fine.estimatedCredits).toBeGreaterThan(card.payload.estimatedCredits);

    const jobId = jobIdOf((await approve(world, card.cardId, await persistedCard(world, card.cardId))).result);
    const rows = await ledgerRows(world.ownerId);
    expect(Math.abs(rows[0]!.balanceDelta)).toBe(fine.estimatedCredits * INTERNAL_PER_DISPLAY);
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: jobId, ownerId: world.ownerId },
      select: { model: true },
    });
    expect(job.model).toBe(PRO_IMAGE_MODEL);
  });

  it("ENGINE-A3 改形状:卡上落的就是他点的那一格,任务行冻的形状与卡一致", async () => {
    if (!imageAspectHonoured()) return;
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const target = GEN_IMAGE_MODEL_OPTIONS[DEFAULT_IMAGE_MODEL].aspectRatios.find(
      (a) => a !== card.payload.params.aspectRatio,
    )!;

    const changed = updatedPayload(
      await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, aspectRatio: target }),
    );
    expect(changed.params.aspectRatio).toBe(target);

    const jobId = jobIdOf((await approve(world, card.cardId, await persistedCard(world, card.cardId))).result);
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: jobId, ownerId: world.ownerId },
      select: { imageOptions: true },
    });
    expect((job.imageOptions as { aspectRatio?: string } | null)?.aspectRatio).toBe(target);
  });

  it("ENGINE-A3 变异证据:卡上的价钉死在旧值(预扣不随卡变)⇒ 付费路在预扣之前拒,ledger 零新增行", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const stale = card.payload.estimatedCredits;
    const fresh = updatedPayload(
      await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 3 }),
    );
    expect(fresh.estimatedCredits).not.toBe(stale);

    // 「报价与预扣不同源」长什么样:张数换了、卡上的价没换。这一张卡必须走不到 reserve。
    await prisma.chatMessage.update({
      where: { id: card.cardId, ownerId: world.ownerId },
      data: { payload: { ...fresh, estimatedCredits: stale } as unknown as object },
    });
    const result = await approve(world, card.cardId, await persistedCard(world, card.cardId));
    expect("error" in result.result).toBe(true);
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
  });

  it("ENGINE-A3 已经在跑的卡改不动 —— 那是一份已经成交的授权", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    jobIdOf((await approve(world, card.cardId, card.payload)).result);

    const refused = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 4 });
    expect("error" in refused).toBe(true);
    expect((await persistedCard(world, card.cardId)).params.count).toBe(1);
  });

  it("ENGINE-A3 跨租户改不动:别人的 cardId 读不到,卡一个字节不动", async () => {
    const owner = await seedWorld(500);
    const card = await mintImageCard(owner);
    const intruder = await seedWorld(500); // 这一行同时把 requireOwner 换成入侵者

    const refused = await ottoUpdateGenCardOptions({ threadId: owner.threadId, cardId: card.cardId, count: 4 });
    expect("error" in refused).toBe(true);
    expect((await persistedCard(owner, card.cardId)).estimatedCredits).toBe(card.payload.estimatedCredits);
    expect((await persistedCard(owner, card.cardId)).params.count).toBe(1);
    expect(await prisma.chatMessage.count({ where: { ownerId: intruder.ownerId, kind: "GEN_CARD" } })).toBe(0);
  });
  // #1230 判官 P2-2 —— 上面那条跨租户用例**不是应用层闸的变异见证**:把这个动作里的两道
  // 应用层闸(读卡 where 上的 `ownerId`、以及 `card.thread.ownerId !== ownerId` 那一句)一起
  // 拆掉,它照样绿 —— 因为底下还有一层 Prisma 租户守卫(packages/db/src/tenant-guard.ts)会
  // 把 `ownerId` 注进每一条语句。所以这一条把**底下那层让开**:身份帧换成一个无租户的
  // 系统帧(守卫对它**只放读、不放写**,也不注 ownerId),而 `requireOwner` 仍然是入侵者。
  //
  // 这一条钉的是**读闸**的承重(尾巴组十一判官 P2-4 纠正上一轮的措辞):拆掉应用层那两道闸
  // 之后,别人的卡确实被读了出来、并进了改档路径 —— 红的那一下是租户守卫拒写
  // (`[tenant-guard] ChatMessage.updateMany requires runAsTenant before system writes`,
  // packages/db/src/tenant-guard.ts),所以越权**写**并没有发生,发生的是一次跨租户**读**泄漏
  // 加一个异常。不能读成「只靠应用层闸拦住越权写」。
  it("ENGINE-A3 跨租户:让 DB 层放行读 —— 拆掉应用层读闸,别人的卡就会被读出来并进改档路径", async () => {
    const owner = await seedWorld(500);
    const card = await mintImageCard(owner);
    const intruder = await seedWorld(500); // 这一行同时把 requireOwner 换成入侵者
    // 底下那层让开:无租户系统帧 ⇒ 守卫不注 ownerId、读一律放行。
    mockResolveUserPrincipal.mockResolvedValue({
      kind: "system",
      reason: "test:tenant-guard-open",
      ownerId: null,
    } as never);

    const refused = await ottoUpdateGenCardOptions({ threadId: owner.threadId, cardId: card.cardId, count: 4 });

    expect(refused).toEqual({ error: "Card not found." });
    mockResolveUserPrincipal.mockImplementation(stubResolveUserPrincipal as never);
    expect((await persistedCard(owner, card.cardId)).params.count).toBe(1);
    expect((await persistedCard(owner, card.cardId)).estimatedCredits).toBe(card.payload.estimatedCredits);
    expect(await prisma.chatMessage.count({ where: { ownerId: intruder.ownerId, kind: "GEN_CARD" } })).toBe(0);
  });

  /**
   * H2 #1234 留下的窗口(Founder 2026-09-04 20:45 清单④)—— **事务外读卡 → 事务内建任务行**。
   *
   * `startCoworkGen` 在钱事务**之外**把卡读出来,任务行却在事务**里**才建。商家(或另一个
   * 标签页)在这两步之间按一下卡上的形状,`ottoUpdateGenCardOptions` 就把 payload 重铸了 ——
   * 钱数不会错(报价对签在事务里),但任务行按的是**旧** payload:卡面写着新的那一档,
   * 上路的却是旧的那一份,同一次生成两个说法。
   *
   * 换形状**不改价**(`pricedGenCredits` 图片侧只看槽位与张数),所以这一条正是专门照住
   * 那道窗口的:没有指纹对签,它会静静通过。
   *
   * 窗口用 `checkCast` 这个缝制造 —— 它跑在读卡之后、钱事务之前(`gen-actions.ts`),
   * 就是那道窗口本身。
   */
  it("ENGINE-A3 读卡之后、建任务行之前卡被改档:整笔拒在 create/reserve 之前,ledger 零新增行", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const priceBefore = card.payload.estimatedCredits;

    (mockCheckCast as unknown as { mockImplementationOnce: (fn: () => Promise<null>) => void })
      .mockImplementationOnce(async () => {
        // 就在窗口里:换一格形状(不改价),卡 payload 因此被重铸。
        const rewritten = updatedPayload(
          await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, aspectRatio: "9:16" }),
        );
        expect(rewritten.estimatedCredits).toBe(priceBefore); // 换形状不改价 —— 报价对签抓不住它
        return null;
      });

    const result = await approve(world, card.cardId, card.payload);
    expect(result.result).toEqual({
      error: "This card changed while you were approving it — review it once more, then generate.",
    });
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // 卡本身仍然是重铸后的那一份:商家再按一次批的就是他刚改出来的那一档。
    expect((await persistedCard(world, card.cardId)).params.aspectRatio).toBe("9:16");
  });

  /**
   * #1239 判官 P2-1 —— 画布节点级那张卡是一次**已经批过、已经扣过**的动作的回执
   * (`canvas-thread-log.ts` 铸的,幂等键是 `canvas:<actionId>`)。上面那道「已经在跑」的
   * 闸只查 `cowork:<cardId>`,所以从前这条 $0 改档路能把一张已成交的收据改写:商家历史
   * 里那张卡说的,就不再是当时真正花掉的那一件事。
   *
   * 两条判据分两条用例钉,变异各红各的:去掉 `canvasAction` 那一句 ⇒ 第一条红;
   * 去掉 `genJobId` 那一句 ⇒ 第二条红。
   */
  it("ENGINE-A3 画布已成交的回执卡改不动:payload 一个字节不动、ledger 零新增行", async () => {
    const world = await seedWorld(500);
    const cardId = `msg_${randomUUID()}`;
    const receipt = buildCanvasPaidCardPayload({
      kind: "image",
      model: DEFAULT_IMAGE_MODEL,
      params: { aspectRatio: "1:1", count: 1 },
      hasSourceImage: false,
      prompt: PROMPT,
      entityIds: [],
      variantSel: null,
      estimatedCredits: 1,
    });
    await prisma.chatMessage.create({
      data: {
        id: cardId,
        threadId: world.threadId,
        ownerId: world.ownerId,
        role: "AGENT",
        kind: "GEN_CARD",
        seq: 1,
        text: "",
        genJobId: `gj_${randomUUID()}`,
        payload: receipt as unknown as object,
      },
    });
    const before = JSON.stringify(await persistedCard(world, cardId));

    const refused = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId, count: 3 });
    expect("error" in refused).toBe(true);
    // 一个字节不动 —— 不是「改了但价没变」,是根本没写。
    expect(JSON.stringify(await persistedCard(world, cardId))).toBe(before);
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);

    // 同一张回执,只是那一格 `genJobId` 缺席(别的铸点、老行)。判它是回执的是 **payload 上
    // 那一格**,不是那一列 —— 这一段单独钉住 `canvasAction` 那条判据本身。
    const noJobId = `msg_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: {
        id: noJobId,
        threadId: world.threadId,
        ownerId: world.ownerId,
        role: "AGENT",
        kind: "GEN_CARD",
        seq: 2,
        text: "",
        payload: receipt as unknown as object,
      },
    });
    const beforeNoJobId = JSON.stringify(await persistedCard(world, noJobId));
    expect("error" in (await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: noJobId, count: 3 }))).toBe(true);
    expect(JSON.stringify(await persistedCard(world, noJobId))).toBe(beforeNoJobId);
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
  });

  it("ENGINE-A3 卡上已经挂了一行任务(genJobId)就改不动 —— 哪怕没有 `cowork:` 那个幂等键", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    // Otto 那张卡自己的形状:payload 上没有 `canvasAction`,但交付路已经把任务行写回卡上。
    await prisma.chatMessage.update({
      where: { id: card.cardId, ownerId: world.ownerId },
      data: { genJobId: `gj_${randomUUID()}` },
    });
    const before = JSON.stringify(await persistedCard(world, card.cardId));

    const refused = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 3 });
    expect("error" in refused).toBe(true);
    expect(JSON.stringify(await persistedCard(world, card.cardId))).toBe(before);
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
  });

  it("ENGINE-A3 没人在窗口里动过卡:指纹对得上,照常建任务行、照常预扣一次", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);

    const jobId = jobIdOf((await approve(world, card.cardId, card.payload)).result);
    const rows = await ledgerRows(world.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refId).toBe(jobId);
  });
});
