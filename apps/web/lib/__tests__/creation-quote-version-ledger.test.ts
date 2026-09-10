/**
 * creation-quote-version-ledger —— 「商家按下的那份报价，还是不是库里这一份？」的全真账本证据。
 *
 * 规格 docs/specs/creation-engine.md §5 :170（FSE-012，Founder 2026-09-10 裁（#1307）：走服务器
 * 校验报价版本，旧报价提交即拒绝并刷新；不锁控件）。
 *
 * **追溯落在 §5 :170 + #1307，不认领任何验收编号。** §2 那张验收表里没有一行覆盖「旧报价
 * 版本提交被服务器拒绝并刷新」：离得最近的 CREATE-A1 讲的是增强稿预览与两条提交路的前置
 * 报价数字相同，与本片没有交集，挂上去只会让 S5 按 CREATE-A1 逐行走查时去演示增强稿预览、
 * 证不了本次改动。补一行验收的请求写在 PR 描述的「要登记的事」里，等下一个冻结版。
 *
 * 走查现象：确认卡上把张数从 1 改到 2，服务端已经重铸了卡，而商家眼前那颗按钮仍写着
 * `Generate · 1 credit`、仍然可点。这一份钉的就是那一下点击的结局：
 *   · 旧版本提交 ⇒ 拒绝，**账本零新增行、零任务行**，而且**刷新后的那张卡**随拒绝一起回来；
 *   · 新版本提交 ⇒ 照常预扣一次；
 *   · 不带版本（老客户端、非卡入口）⇒ 照旧放行，与从前逐字相同。
 *
 * 真 Postgres（*_test）、真 Prisma、真 credit ledger（经真 `coworkGenerate` → `startCoworkGen`
 * → `startGen` 的 `reserveCredits`）；替身只有 startGen 周边的 web 管线，与
 * `otto-card-options-ledger.test.ts` 同一套、同一批 mock。零真实 provider 调用、零真实花费。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, cardQuoteVersion, QUOTE_VERSION_STALE } from "@fikirtive/core";
import { buildProposeCard, type CardPayload, type OttoContext } from "@fikirtive/otto";

const mockRequireOwner = vi.fn();
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

/**
 * 第二条批准路（`ottoApprove`）的两个替身，也只有这两个：
 *
 *  · `tryRestoreRunStateWithContext` —— 那条路要把一份序列化的 RunState 重新泡开才走得下去，
 *    而 RunState 是引擎 SDK 的东西，不是这道闸的事。替身交回一份**停在 generate 上、绑着这张
 *    卡**的最小状态，让这条路走进它的「普通生成」分支；
 *  · `runOttoTurn` —— 恢复轮那一步。替身把 `ottoApprove` **自己传进来的** `execution.meter`
 *    （生产那一个 `withLlmBudget`）按生产的形状调用一次：真预扣 → 跑「模型」（零 token 的
 *    替身）→ 真结算。**钱是真的**，账本行是真 Postgres 里的真行。
 *
 * 这两个替身合起来正是这一组用例的承重点：闸的另一边**就是钱**。旧报价那一条因此不是
 * 「返回了一句话」，而是「那一趟连预扣都没发生」。
 */
const mockRestoreRunState = vi.fn();
const mockRunOttoTurn = vi.fn();
vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    tryRestoreRunStateWithContext: (...args: unknown[]) => mockRestoreRunState(...args),
    runOttoTurn: (...args: unknown[]) => mockRunOttoTurn(...args),
  };
});

const { ottoBudgetArgsFor } = await import("@fikirtive/otto");
const { coworkGenerate } = await import("../cowork-actions");
const { ottoUpdateGenCardOptions, ottoApprove } = await import("../otto-actions");
const { toChatMessageDTO } = await import("../dto");
const { parsePlanCardPayload } = await import("@/components/otto/plan-card-contract");
const { prisma } = await import("@fikirtive/db");

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
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Quote version" } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, projectId, threadId };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

async function mintImageCard(world: World): Promise<{ cardId: string; payload: CardPayload }> {
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
      seq: 1,
      text: "",
      payload: cardPayload as unknown as object,
    },
  });
  return { cardId, payload: cardPayload };
}

async function persistedCard(world: World, cardId: string): Promise<CardPayload> {
  const row = await prisma.chatMessage.findFirstOrThrow({
    where: { id: cardId, ownerId: world.ownerId, kind: "GEN_CARD" },
    select: { payload: true },
  });
  return row.payload as unknown as CardPayload;
}

/** 商家按下那颗 `Generate · N credits` —— 与 `plan-approval.ts` 送出去的**同一份**东西。 */
async function pressGenerate(world: World, cardId: string, payload: CardPayload, quoteVersion?: string) {
  return coworkGenerate({
    cardId,
    prompt: payload.structuredPrompt ?? "",
    entityIds: payload.entityIds ?? [],
    variantSel: payload.variantSel ?? {},
    ...(quoteVersion === undefined ? {} : { quoteVersion }),
  });
}

async function ledgerRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}

/**
 * 把第二条批准路（Otto 停下来等批准的那张卡 → `ottoApprove`）布置成**真的走得下去**：
 * 线程上有一份暂停的 RunState，那份状态停在绑着这张卡的 `generate` 上，恢复轮进到 metered
 * 的那一步。布置完之后，这条路上唯一还没定的事就是「他按下的是哪一版报价」。
 */
async function armApprovalResume(world: World, cardId: string) {
  await prisma.chatThread.updateMany({
    where: { id: world.threadId, ownerId: world.ownerId },
    data: { ottoState: "{paused}" },
  });
  const interruption = { name: "generate", arguments: JSON.stringify({ cardId }) };
  const approve = vi.fn();
  mockRestoreRunState.mockResolvedValue({ _generatedItems: [], getInterruptions: () => [interruption], approve });
  mockRunOttoTurn.mockImplementation(
    async (
      request: Parameters<typeof ottoBudgetArgsFor>[1],
      ctx: Parameters<typeof ottoBudgetArgsFor>[2],
      runtime: Parameters<typeof ottoBudgetArgsFor>[0],
      execution: { meter: (args: unknown, fn: () => Promise<unknown>) => Promise<unknown> },
    ) =>
      // 生产的 `withLlmBudget`（`ottoApprove` 自己传进来的那一个），生产的预算参数。
      execution.meter(ottoBudgetArgsFor(runtime, request, ctx), async () => ({
        result: { finalOutput: "", state: {} },
        usage: { inputTokens: 0, outputTokens: 0 },
      })),
  );
  return { approve };
}

/** 恢复轮那一次预扣 —— 第二条批准路上**第一笔钱**（refId = `otto-approve:<thread>:<card>:a<n>`）。 */
function resumeReserveRows(rows: { kind: string; refId: string | null }[], world: World, cardId: string) {
  return rows.filter((r) => r.kind === "RESERVE" && (r.refId ?? "").startsWith(`otto-approve:${world.threadId}:${cardId}:`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveUserPrincipal.mockImplementation(stubResolveUserPrincipal as never);
});

describe("creation §5 :170 FSE-012 服务器校验报价版本", () => {
  it("creation §5 :170 FSE-012 数量 1→2 后用旧报价版本提交:拒绝、账本零新增行,并交回刷新后的报价", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    // 商家眼前那一版:1 张、1 credit。这一串就是那颗按钮上写的那份报价的身份。
    const staleVersion = cardQuoteVersion(card.payload);

    // 另一处(或上一趟排队的那一格)把卡改成 2 张 —— 服务端重铸,价随之变。
    const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
    if ("error" in rebuilt) throw new Error(`改档被拒:${rebuilt.error}`);
    expect(rebuilt.payload.params.count).toBe(2);
    expect(rebuilt.payload.estimatedCredits).not.toBe(card.payload.estimatedCredits);

    // 商家按下的仍是旧那颗按钮(控件没锁,他点得动)。
    const res = await pressGenerate(world, card.cardId, card.payload, staleVersion);

    expect(res).toMatchObject({ error: QUOTE_VERSION_STALE });
    // 刷新后的报价随拒绝一起回来 —— 界面据此换掉卡面,商家看到新价再决定。
    const quote = (res as { quote?: unknown }).quote as CardPayload;
    expect(quote.estimatedCredits).toBe(rebuilt.payload.estimatedCredits);
    expect(quote.params.count).toBe(2);
    // 零预扣、零任务行:拒在 create/reserve 之前。
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // 卡本身一个字节没动 —— 拒绝不是一次写。
    expect((await persistedCard(world, card.cardId)).params.count).toBe(2);
  });

  it("creation §5 :170 FSE-012 刷新后按新报价版本再提交:照常建任务行、预扣一次", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
    if ("error" in rebuilt) throw new Error(`改档被拒:${rebuilt.error}`);

    const fresh = await persistedCard(world, card.cardId);
    const res = await pressGenerate(world, card.cardId, fresh, cardQuoteVersion(fresh));

    if ("error" in res) throw new Error(`新版本仍被拒:${res.error}`);
    const rows = await ledgerRows(world.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("RESERVE");
    expect(Math.abs(rows[0]!.balanceDelta)).toBe(rebuilt.payload.estimatedCredits * INTERNAL_PER_DISPLAY);
    expect(rows[0]!.refId).toBe(res.id);
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: res.id, ownerId: world.ownerId },
      select: { count: true },
    });
    expect(job.count).toBe(2);
  });

  it("creation §5 :170 FSE-012 没人动过卡:版本对得上,预扣一次", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);

    const res = await pressGenerate(world, card.cardId, card.payload, cardQuoteVersion(card.payload));

    if ("error" in res) throw new Error(`未改过的卡被拒:${res.error}`);
    expect(await ledgerRows(world.ownerId)).toHaveLength(1);
  });

  it("creation §5 :170 FSE-012 不带版本的提交(老客户端 / 非卡入口)照旧放行", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });

    const res = await pressGenerate(world, card.cardId, card.payload);

    if ("error" in res) throw new Error(`不带版本被拒:${res.error}`);
    expect(await ledgerRows(world.ownerId)).toHaveLength(1);
  });

  /**
   * 这一条钉的是这道闸能不能用的**前提**:刷新之后浏览器手上那份卡是走 DTO + 客户端解析
   * 拿到的,而 DTO 出于供应商保密丢掉 `model`／`reason`、`params` 只留白名单五格。指纹只要
   * 读了一格 DTO 丢掉的东西,商家每一次刷新后的批准都会被误判成「价变了」—— 一道本来在治
   * 「说的与做的分家」的闸,会变成一道谁都过不去的墙。
   */
  it("creation §5 :170 FSE-012 刷新后那条读路(DTO + 客户端解析)算出的版本与库里那张卡一致", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 3 });

    // 刷新那一趟:库 → DTO → 客户端解析,浏览器手上的就是这一份。
    const row = await prisma.chatMessage.findFirstOrThrow({
      where: { id: card.cardId, ownerId: world.ownerId },
    });
    const dto = toChatMessageDTO(row as never, new Map());
    const asClientSeesIt = parsePlanCardPayload(dto.payload);
    expect(asClientSeesIt).not.toBeNull();
    // 型号那一格确实被丢掉了 —— 这一条断言就是上面那句话的证据,不是假设。
    expect((dto.payload as Record<string, unknown>).model).toBeUndefined();

    const res = await pressGenerate(
      world,
      card.cardId,
      await persistedCard(world, card.cardId),
      cardQuoteVersion(asClientSeesIt!.value),
    );

    if ("error" in res) throw new Error(`刷新后的卡被误判成价变了:${res.error}`);
    expect(await ledgerRows(world.ownerId)).toHaveLength(1);
  });

  it("creation §5 :170 FSE-012 已经成交的那张卡:旧版本第二次点击仍幂等取回原任务,不被说成失败", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const first = await pressGenerate(world, card.cardId, card.payload, cardQuoteVersion(card.payload));
    if ("error" in first) throw new Error(`第一次批准被拒:${first.error}`);

    // 同一张卡再点一次,而且这一次带的是一个对不上的版本 —— 幂等取回优先于报价校验:
    // 一次已经成交的动作不该被说成「价变了」。
    const again = await pressGenerate(world, card.cardId, card.payload, "not-a-real-version");

    expect(again).toEqual({ id: first.id });
    expect(await ledgerRows(world.ownerId)).toHaveLength(1);
  });
});

/**
 * 第二条批准路。上面那一组走的是**刚被提议**的卡（`coworkGenerate`）；Otto 自己停下来等批准
 * 的那张卡走的是 `ottoApprove`，那是另一段代码、另一处钱。两条路共用同一道闸
 * （`apps/web/lib/card-quote-version.ts`），所以两条路都要有自己的行为证据 —— 一道只在其中
 * 一条路上被证过的闸，等于另一条路上商家照旧按着旧价成交。
 */
describe("creation §5 :170 FSE-012 第二条批准路(ottoApprove)共用同一道闸", () => {
  it("creation §5 :170 FSE-012 ottoApprove 收到旧报价版本:拒绝、恢复轮从未进入、账本零新增行,并交回刷新后的报价", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await armApprovalResume(world, card.cardId);
    const staleVersion = cardQuoteVersion(card.payload);

    // 另一处把卡改成 2 张 —— 服务端重铸,价随之变;商家眼前那颗按钮仍写着旧数字。
    const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
    if ("error" in rebuilt) throw new Error(`改档被拒:${rebuilt.error}`);

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: staleVersion });

    expect(res).toMatchObject({ error: QUOTE_VERSION_STALE });
    // 刷新后的报价随拒绝一起回来 —— 与第一条路同一份形状,界面据此换掉卡面。
    const quote = (res as { quote?: unknown }).quote as CardPayload;
    expect(quote.estimatedCredits).toBe(rebuilt.payload.estimatedCredits);
    expect(quote.params.count).toBe(2);
    // **拒在花钱之前**:metered 的恢复轮一次都没进过,账本零行、零任务行。
    expect(mockRunOttoTurn).not.toHaveBeenCalled();
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // 那份暂停的 RunState 也一个字节没动 —— 拒绝什么都没消费。
    const thread = await prisma.chatThread.findFirstOrThrow({ where: { id: world.threadId, ownerId: world.ownerId } });
    expect(thread.ottoState).toBe("{paused}");
  });

  it("creation §5 :170 FSE-012 ottoApprove 版本对得上:同一次点击真的走进恢复轮并预扣 —— 闸的另一边就是钱", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await armApprovalResume(world, card.cardId);
    const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
    if ("error" in rebuilt) throw new Error(`改档被拒:${rebuilt.error}`);

    // 与上一条**逐字相同的布置**,只换一件事:带的是刷新后那张卡的版本。
    const fresh = await persistedCard(world, card.cardId);
    await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: cardQuoteVersion(fresh) });

    expect(mockRunOttoTurn).toHaveBeenCalledTimes(1);
    // 真账本里真有那一笔预扣 —— 上一条那句「拒在花钱之前」因此不是一句形容。
    expect(resumeReserveRows(await ledgerRows(world.ownerId), world, card.cardId)).toHaveLength(1);
  });

  it("creation §5 :170 FSE-012 ottoApprove 不带版本(老客户端 / 非卡入口)照旧放行", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await armApprovalResume(world, card.cardId);
    await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });

    await ottoApprove({ threadId: world.threadId, cardId: card.cardId });

    expect(mockRunOttoTurn).toHaveBeenCalledTimes(1);
    expect(resumeReserveRows(await ledgerRows(world.ownerId), world, card.cardId)).toHaveLength(1);
  });

  it("creation §5 :170 FSE-012 ottoApprove 已经成交的那张卡:旧版本第二次点击不被说成价变了", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await armApprovalResume(world, card.cardId);
    // 第一条路先把这张卡成交掉 —— 卡上从此挂着任务行。
    const first = await pressGenerate(world, card.cardId, card.payload, cardQuoteVersion(card.payload));
    if ("error" in first) throw new Error(`第一次批准被拒:${first.error}`);
    await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });

    // 同一张卡在第二条路上再点一次,带的是一个对不上的版本:幂等取回优先于报价校验,
    // 一次已经成交的动作不该被说成「价变了」。
    const again = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: "not-a-real-version" });

    expect(again).not.toMatchObject({ error: QUOTE_VERSION_STALE });
    expect((await ledgerRows(world.ownerId)).filter((r) => r.kind === "RESERVE" && r.refId === `reserve:${first.id}`)).toHaveLength(0);
  });
});
