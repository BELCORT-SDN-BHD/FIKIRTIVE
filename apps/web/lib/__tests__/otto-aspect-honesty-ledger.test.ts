/**
 * otto-aspect-honesty-ledger —— 商家在**对话里**点名画幅,钱路的全真账本证据。
 *
 * 规格 docs/specs/creation-engine.md,验收 CREATE-A1 / CREATE-A4(§5 登记 2026-09-04,
 * Codex E2E QA-CRE-FE9-014:商家两次说 4:5,确认卡写着「2048 × 2048 · 1:1」,
 * GenJob 冻的是 `{"aspectRatio":"1:1"}`)。
 *
 * 纯判据(哪几格做得到、做不到怎么说、拒绝句里列什么)钉在
 * `packages/otto/src/skills/propose.test.ts`;这一份只证**账本上真的发生了什么**:
 *   · CREATE-A1:做得到的那一格(3:4)—— 卡上、GenJob 冻的那一份、付费请求体是同一格;
 *   · CREATE-A4:做不到的那一格(4:5)—— 零 GEN_CARD、零 GenJob、ledger 零新增行、余额一分不动。
 *
 * 真 Postgres(*_test)、真 Prisma、真 credit ledger(经真 `startCoworkGen` → `startGen` 的
 * `reserveCredits`)—— 零真实 provider 调用、零真实花费。只有 startGen 周边的 web 管线是
 * 替身,与 `otto-resolution-tier-ledger.test.ts` 同一套。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, buildGenRequestFromCard } from "@fikirtive/core";
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
const { prisma } = await import("@fikirtive/db");

const PROMPT = "A pandan kaya jar on a marble counter, soft morning light";

/** 商家做广告最常问的那个竖版尺寸 —— 这台引擎的能力表上**没有**这一格。 */
const UNMAKEABLE = "4:5";
/** 能力表上真有、而且离 4:5 最近的那一格。 */
const MAKEABLE = "3:4";

function ottoCtx(over: { orgId: string; projectId: string; threadId: string }): OttoContext {
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
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Otto aspect" } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, projectId, threadId };
}

/** Otto 铸卡 → 原样落库成一张 GEN_CARD。卡 payload 一个字节都不改写。 */
async function mintCard(
  world: { ownerId: string; projectId: string; threadId: string },
  desiredAspect: string,
  seq: number,
): Promise<{ cardId: string; payload: CardPayload }> {
  const { cardPayload } = buildProposeCard(
    {
      kind: "image",
      structuredPrompt: PROMPT,
      entityIds: [],
      variantSel: {},
      desiredAspect,
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

function jobIdOf(result: Awaited<ReturnType<typeof startCoworkGen>>): string {
  if ("error" in result) throw new Error(`startCoworkGen 失败:${result.error}`);
  return result.id;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CREATE-A4 Otto 卡上点名的画幅,一路走到账本", () => {
  it("CREATE-A1 商家要 3:4(做得到):卡上、GenJob 冻的那一份、付费请求体是同一格", async () => {
    const world = await seedWorld(500);
    const card = await mintCard(world, MAKEABLE, 1);

    // 卡面这一格 —— 商家在花钱前看到的那一份。
    expect(card.payload.params.aspectRatio).toBe(MAKEABLE);
    expect(card.payload.downgraded).toBe(false);
    expect(card.payload.specChips).toContain(MAKEABLE);

    const { req, result } = await approve(world, card);
    expect(req.aspectRatio).toBe(MAKEABLE);
    const jobId = jobIdOf(result);

    // 任务行:冻下来的画幅就是卡上那一格,不是默认方图。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: jobId, ownerId: world.ownerId },
      select: { imageOptions: true, idempotencyKey: true },
    });
    expect((job.imageOptions as { aspectRatio?: string }).aspectRatio).toBe(MAKEABLE);
    expect(job.idempotencyKey).toBe(`cowork:${card.cardId}`);

    // 预扣:金额逐格等于卡面那个数(先披露,后扣费)。
    const rows = await ledgerRows(world.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("RESERVE");
    expect(Math.abs(rows[0]!.balanceDelta)).toBe(card.payload.estimatedCredits * INTERNAL_PER_DISPLAY);
  });

  it("CREATE-A4 商家要 4:5(做不到)⇒ 零 GEN_CARD、零 GenJob、ledger 零新增行、余额一分不动", async () => {
    const world = await seedWorld(500);
    await expect(mintCard(world, UNMAKEABLE, 1)).rejects.toBeInstanceOf(ProposeRefusal);

    expect(await prisma.chatMessage.count({ where: { ownerId: world.ownerId, kind: "GEN_CARD" } })).toBe(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect((await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: world.ownerId } })).balance)
      .toBe(500 * INTERNAL_PER_DISPLAY);
  });

  it("CREATE-A4 拒绝之后改说 3:4 ⇒ 这一趟照常铸卡收费,守卫只挡做不到的那一格", async () => {
    const world = await seedWorld(500);
    await expect(mintCard(world, UNMAKEABLE, 1)).rejects.toBeInstanceOf(ProposeRefusal);

    const card = await mintCard(world, MAKEABLE, 2);
    const jobId = jobIdOf((await approve(world, card)).result);
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: jobId, ownerId: world.ownerId },
      select: { imageOptions: true },
    });
    expect((job.imageOptions as { aspectRatio?: string }).aspectRatio).toBe(MAKEABLE);
    // 账本上只有这一单 —— 被拒绝的那一句从头到尾没留下任何一行。
    const rows = await ledgerRows(world.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refId).toBe(jobId);
  });
});

describe("CREATE-A1 付费批准只从确认卡触发,聊天里的话一分钱都动不了", () => {
  /**
   * Codex QA-CRE-FE9-004 —— Otto 曾同时说「Just say yes and I'll submit it」与卡上的
   * `Generate · 1 credit`,两套批准。这里证的是**服务端本来就只有一条路**:
   * 付费入口 `startCoworkGen` 只收一张已落库的卡装出来的请求(`buildGenRequestFromCard`),
   * 聊天文本没有任何一条通道能变成它。所以叙述里那第二条指令是纯粹的假承诺 ——
   * 它对应的服务端动作根本不存在(话术那一半钉在 `packages/otto/src/instructions.test.ts`)。
   */
  it("CREATE-A1 聊天文本「yes」装不成付费请求 ⇒ 零 GenJob、ledger 零新增行", async () => {
    const world = await seedWorld(500);
    await prisma.chatMessage.create({
      data: {
        id: `msg_${randomUUID()}`,
        threadId: world.threadId,
        ownerId: world.ownerId,
        role: "USER",
        kind: "TEXT",
        seq: 1,
        text: "yes",
      },
    });

    // 商家那句话就是一条 TEXT 消息 —— 它不是卡,装不成付费请求。
    for (const notACard of ["yes", "go ahead", "make it"]) {
      const built = buildGenRequestFromCard({
        cardPayload: { kind: "image", structuredPrompt: notACard },
        projectId: world.projectId,
        threadId: world.threadId,
        cardId: `msg_${randomUUID()}`,
        entityIds: [],
        variantSel: {},
      });
      expect(built.ok, `聊天文本「${notACard}」不许装成付费请求`).toBe(false);
    }

    expect(await prisma.chatMessage.count({ where: { ownerId: world.ownerId, kind: "GEN_CARD" } })).toBe(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect((await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: world.ownerId } })).balance)
      .toBe(500 * INTERNAL_PER_DISPLAY);
  });
});
