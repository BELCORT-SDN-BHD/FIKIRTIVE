/**
 * otto-resolution-tier-ledger —— 商家在**对话里**点名画质档,钱路的全真账本证据。
 *
 * 规格 docs/specs/creation-engine.md,验收 CREATE-A1 / CREATE-A4(§5 登记 2026-09-04,
 * Founder 裁决「Otto 改档＝要,现在做」)。
 *
 * 纯判据(档位挑槽位、卡上带哪一档、卡按哪一档报价、拒绝还是降级)钉在
 * `packages/otto/src/skills/propose.test.ts` 与 `packages/core/src/cowork-route.test.ts`;
 * 这一份只证**账本上真的发生了什么**:
 *   · CREATE-A4:Otto 卡上写着 1080p ⇒ 卡面报价 == `reserve:<jobId>` 绝对值 ==
 *     `settle:<jobId>` 绝对值,而且任务行冻下来的分辨率就是卡上那一档;
 *   · CREATE-A4:改档 = 新卡新键 ⇒ 两次批准是两笔各自授权的钱,老卡带不出新规格;
 *   · CREATE-A4:未定价的档 ⇒ 一张卡都不落库、**ledger 零新增行**、零 GenJob。
 *
 * 真 Postgres(*_test)、真 Prisma、真 credit ledger(经真 `startCoworkGen` → `startGen` 的
 * `reserveCredits`),worker 的结算走它自己那个函数(`settleCredits`)原样模拟 ——
 * 零真实 provider 调用、零真实花费。只有 startGen 周边的 web 管线是替身,与
 * `creation-routing-ledger.test.ts` / `gen-ledger.test.ts` 同一套。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  HD_VIDEO_RESOLUTION,
  INTERNAL_PER_DISPLAY,
  buildGenRequestFromCard,
  routeVideoModel,
} from "@fikirtive/core";
import { ProposeRefusal, buildProposeCard, type CardPayload, type OttoContext } from "@fikirtive/otto";

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

const { startCoworkGen } = await import("../gen-actions");
const { prisma, settleCredits } = await import("@fikirtive/db");

/** 1080p 5 秒 = 11cr/秒 × 5 = 55 显示 credits(Founder 2026-09-02 追认,规格 §5)。
 *  这个常量只用来**交叉核对**卡面价,不用来替代它 —— 价仍由单一价目源现算。 */
const HD_5S_DISPLAY = 55;

const PROMPT = "A slow push-in on the pandan kaya jar on a marble counter";

function ottoCtx(over: Partial<OttoContext> & { orgId: string; projectId: string; threadId: string }): OttoContext {
  return {
    userId: "user-test",
    disabledModels: [],
    sourceGenerationId: null,
    ...over,
  } as OttoContext;
}

async function seedWorld(balanceDisplay: number) {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({
    data: { orgId: ownerId, balance: balanceDisplay * INTERNAL_PER_DISPLAY, reserved: 0 },
  });
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Otto tier" } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, projectId, threadId };
}

/** Otto 铸卡 → 原样落库成一张 GEN_CARD。卡 payload 一个字节都不改写:
 *  商家批准的那一份、`startCoworkGen` 读回来的那一份,与铸卡器产出的那一份是同一份。 */
async function mintCard(
  world: { ownerId: string; projectId: string; threadId: string },
  desiredResolution: string | undefined,
  seq: number,
): Promise<{ cardId: string; payload: CardPayload }> {
  const { cardPayload } = buildProposeCard(
    {
      kind: "video",
      structuredPrompt: PROMPT,
      entityIds: [],
      variantSel: {},
      ...(desiredResolution ? { desiredResolution } : {}),
    },
    ottoCtx({ orgId: world.ownerId, projectId: world.projectId, threadId: world.threadId }),
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

/** 商家按下确认的那一刻:卡 → 付费请求(与 `plan-approval` 走的是同一个纯装配器)。 */
async function approve(
  world: { projectId: string; threadId: string },
  card: { cardId: string; payload: CardPayload },
) {
  const built = buildGenRequestFromCard({
    cardPayload: card.payload,
    projectId: world.projectId,
    threadId: world.threadId,
    cardId: card.cardId,
    entityIds: card.payload.entityIds,
    variantSel: card.payload.variantSel,
  });
  if (!built.ok) throw new Error(`卡装不成付费请求:${built.error}`);
  return { req: built.req, result: await startCoworkGen(built.req) };
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

function jobIdOf(result: Awaited<ReturnType<typeof startCoworkGen>>): string {
  if ("error" in result) throw new Error(`startCoworkGen 失败:${result.error}`);
  return result.id;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CREATE-A4 Otto 卡上点名的画质档,一路走到账本", () => {
  it("CREATE-A4 商家要 1080p:卡面报价 == reserve 绝对值 == settle 绝对值,任务行冻的就是这一档", async () => {
    const world = await seedWorld(500);
    const card = await mintCard(world, HD_VIDEO_RESOLUTION, 1);

    // 卡面这一格 —— 商家在花钱前看到的那一份。
    expect(card.payload.params.resolution).toBe(HD_VIDEO_RESOLUTION);
    expect(card.payload.model).toBe(routeVideoModel(HD_VIDEO_RESOLUTION).model);
    expect(card.payload.estimatedCredits).toBe(HD_5S_DISPLAY);

    const { result } = await approve(world, card);
    const jobId = jobIdOf(result);

    // 任务行:引擎槽位与分辨率都是卡上那一份,不是默认那一份。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: jobId, ownerId: world.ownerId },
      select: { model: true, videoOptions: true, idempotencyKey: true },
    });
    expect(job.model).toBe(card.payload.model);
    expect((job.videoOptions as { resolution?: string }).resolution).toBe(HD_VIDEO_RESOLUTION);
    expect(job.idempotencyKey).toBe(`cowork:${card.cardId}`);

    // 预扣:金额逐格等于卡面那个数(先披露,后扣费)。
    const afterReserve = await ledgerRows(world.ownerId);
    expect(afterReserve).toHaveLength(1);
    expect(afterReserve[0]!.kind).toBe("RESERVE");
    expect(afterReserve[0]!.refId).toBe(jobId);
    expect(Math.abs(afterReserve[0]!.balanceDelta)).toBe(card.payload.estimatedCredits * INTERNAL_PER_DISPLAY);
    expect(Math.abs(afterReserve[0]!.reservedDelta)).toBe(card.payload.estimatedCredits * INTERNAL_PER_DISPLAY);

    // 结算:同一个数落账 —— `reserve:<jobId>` 与 `settle:<jobId>` 绝对值相等(CREATE-A4 原话)。
    await workerSettle(world.ownerId, jobId);
    const rows = await ledgerRows(world.ownerId);
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expect(rows[1]!.refId).toBe(jobId);
    expect(Math.abs(rows[1]!.reservedDelta)).toBe(Math.abs(rows[0]!.reservedDelta));
    expect(Math.abs(rows[1]!.reservedDelta)).toBe(card.payload.estimatedCredits * INTERNAL_PER_DISPLAY);
  });

  it("CREATE-A4 商家要 480p:同一条链、按 480p 收,比 1080p 那一单少扣", async () => {
    const cheapWorld = await seedWorld(500);
    const cheapCard = await mintCard(cheapWorld, "480p", 1);
    expect(cheapCard.payload.params.resolution).toBe("480p");
    const cheapJob = jobIdOf((await approve(cheapWorld, cheapCard)).result);
    const cheapRows = await ledgerRows(cheapWorld.ownerId);
    expect(Math.abs(cheapRows[0]!.balanceDelta)).toBe(cheapCard.payload.estimatedCredits * INTERNAL_PER_DISPLAY);
    expect(
      ((await prisma.genJob.findFirstOrThrow({ where: { id: cheapJob, ownerId: cheapWorld.ownerId }, select: { videoOptions: true } }))
        .videoOptions as { resolution?: string }).resolution,
    ).toBe("480p");

    const hdWorld = await seedWorld(500);
    const hdCard = await mintCard(hdWorld, HD_VIDEO_RESOLUTION, 1);
    jobIdOf((await approve(hdWorld, hdCard)).result);
    const hdRows = await ledgerRows(hdWorld.ownerId);

    expect(Math.abs(cheapRows[0]!.balanceDelta)).toBeLessThan(Math.abs(hdRows[0]!.balanceDelta));
  });

  it("CREATE-A4 改档 = 新卡新幂等键:两次批准是两笔各自授权的钱,老卡带不出新规格", async () => {
    const world = await seedWorld(500);
    const first = await mintCard(world, "720p", 1);
    const second = await mintCard(world, HD_VIDEO_RESOLUTION, 2);
    expect(second.cardId).not.toBe(first.cardId);

    const firstRun = await approve(world, first);
    const firstJob = jobIdOf(firstRun.result);
    const secondRun = await approve(world, second);
    const secondJob = jobIdOf(secondRun.result);

    // 身份跟着卡走 —— 两把不同的钥匙,所以改档不可能被当成同一次动作复用。
    expect(secondRun.req.idempotencyKey).not.toBe(firstRun.req.idempotencyKey);
    expect(secondJob).not.toBe(firstJob);

    const jobs = await prisma.genJob.findMany({
      where: { id: { in: [firstJob, secondJob] }, ownerId: world.ownerId },
      select: { id: true, videoOptions: true },
    });
    const resolutionOf = (id: string) =>
      (jobs.find((j) => j.id === id)!.videoOptions as { resolution?: string }).resolution;
    expect(resolutionOf(firstJob)).toBe("720p");
    expect(resolutionOf(secondJob)).toBe(HD_VIDEO_RESOLUTION);

    // 账本:两单各自 RESERVE 一行,金额各按自己那一档 —— 老卡照旧只扣老价。
    const rows = await ledgerRows(world.ownerId);
    expect(rows).toHaveLength(2);
    expect(Math.abs(rows[0]!.balanceDelta)).toBe(first.payload.estimatedCredits * INTERNAL_PER_DISPLAY);
    expect(Math.abs(rows[1]!.balanceDelta)).toBe(second.payload.estimatedCredits * INTERNAL_PER_DISPLAY);
    expect(rows[0]!.balanceDelta).not.toBe(rows[1]!.balanceDelta);
  });

  it("CREATE-A4 未定价的档(4k)⇒ 一张卡都不铸:零 GEN_CARD、零 GenJob、ledger 零新增行", async () => {
    const world = await seedWorld(500);
    await expect(mintCard(world, "4k", 1)).rejects.toBeInstanceOf(ProposeRefusal);

    expect(await prisma.chatMessage.count({ where: { ownerId: world.ownerId, kind: "GEN_CARD" } })).toBe(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect((await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: world.ownerId } })).balance)
      .toBe(500 * INTERNAL_PER_DISPLAY);
  });
});
