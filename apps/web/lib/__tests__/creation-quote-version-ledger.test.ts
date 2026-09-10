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
import { readFileSync } from "node:fs";
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

const { ottoBudgetArgsFor, executeGenerate, MaxTurnsExceededError } = await import("@fikirtive/otto");
// 判官第 6 轮 P1 —— 「闸读卡之后、钱事务之前」那一格窗口的把手：守望者这一步就在窗口里
// （`gen-actions.ts` 把 checkCast 排在 `prisma.$transaction` 之前），所以并发重铸演在这里。
const { checkCast } = await import("../cowork-guardian");
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
let capturedResumeCtx: { approvedQuoteVersion?: { cardId: string; version: string } } | null = null;

/** 线程上那份「停在这张卡的 generate 上」的暂停状态。停车位在不在，这一串说了算。 */
const PAUSED_STATE = "{paused}";

async function armApprovalResume(
  world: World,
  cardId: string,
  opts?: {
    /**
     * 判官第 4 轮 P1 —— 在**恢复轮跑着的时候**发生的事（商家在另一处又改了一格）。
     * 它跑在 metered 的那一段里面，也就是恢复轮里 `generate` 技能读卡的那个位置，
     * 所以这一钩子布置出来的正是那道迟到的闸要面对的那一刻。
     */
    duringResume?: () => Promise<void>;
    /**
     * 验收 R1 —— 恢复轮里**真的把 `generate` 技能跑一遍**（真 `executeGenerate`、真 ctx、
     * 真 `ctx.startGen`）。替身因此不再替这道闸作答：拒绝是那个技能自己拒的，成交是它自己
     * 经 `startCoworkGen` → `startGen` 花的钱。R1 那三条「再按一次就成功」只有这样才算数。
     */
    runGenerate?: boolean;
    /**
     * 判官第 5 轮 P2-b —— 恢复轮跑完之后**又停在别的批准上**（`needs_approval` 那个终局分支）。
     * 传进来的是那一张仍停着的卡的 id：finalizer 从这一格读出「还有人在等批准」。
     */
    parkAgainOnCardId?: string;
    /**
     * 判官第 6 轮 P1 —— 恢复轮**跑完那一步之后**炸掉（步数上限那一支）。返回要抛的那个
     * 错，让用例自己决定它是哪一种（`MaxTurnsExceededError` 走 degraded 那个终局出口）。
     */
    throwAfterGenerate?: () => Error;
  },
) {
  capturedResumeCtx = null;
  await prisma.chatThread.updateMany({
    where: { id: world.threadId, ownerId: world.ownerId },
    data: { ottoState: PAUSED_STATE },
  });
  const interruption = { name: "generate", arguments: JSON.stringify({ cardId }) };
  const approve = vi.fn();
  // 停车位跟着**库里那份状态**走（`tryRestoreRunStateWithContext` 拿到的第二个参数就是它）：
  // 线程还停在那一版 ⇒ 这张卡仍等着批准；那一版被恢复轮盖掉 ⇒ 停车位没了，第二次点击会
  // 得到「That card isn't awaiting approval.」。R1 要证的正是这条因果，所以替身不许把它抹平。
  mockRestoreRunState.mockImplementation(async (...args: unknown[]) => {
    const parked = args[1] === PAUSED_STATE;
    return { _generatedItems: [], getInterruptions: () => (parked ? [interruption] : []), approve };
  });
  mockRunOttoTurn.mockImplementation(
    async (
      request: Parameters<typeof ottoBudgetArgsFor>[1],
      ctx: Parameters<typeof ottoBudgetArgsFor>[2],
      runtime: Parameters<typeof ottoBudgetArgsFor>[0],
      execution: { meter: (args: unknown, fn: () => Promise<unknown>) => Promise<unknown> },
    ) => {
      // 恢复轮真正拿到的那份 ctx —— `generate` 技能在这一份上读「他批的是哪一版报价」。
      capturedResumeCtx = ctx as unknown as { approvedQuoteVersion?: { cardId: string; version: string } };
      // 生产的 `withLlmBudget`（`ottoApprove` 自己传进来的那一个），生产的预算参数。
      return execution.meter(ottoBudgetArgsFor(runtime, request, ctx), async () => {
        if (opts?.duringResume) await opts.duringResume();
        if (opts?.runGenerate) await executeGenerate({ cardId }, { context: ctx } as never);
        if (opts?.throwAfterGenerate) throw opts.throwAfterGenerate();
        return {
          result: {
            finalOutput: "",
            state: {},
            ...(opts?.parkAgainOnCardId
              ? { interruptions: [{ name: "generate", arguments: JSON.stringify({ cardId: opts.parkAgainOnCardId }) }] }
              : {}),
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      });
    },
  );
  return { approve };
}

/** 拒绝交回来的那张卡，在浏览器手上算出来的那一串 —— 与 `plan-approval.ts` 逐字同一条路。 */
function clientQuoteVersionOf(quote: unknown): string {
  const parsed = parsePlanCardPayload(quote);
  if (!parsed) throw new Error("交回来的那张卡客户端解析不了");
  return cardQuoteVersion(parsed.value);
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

  /**
   * 判官第 3 轮 P2-c —— 拒绝时交回浏览器的那张卡,上一版是**库里那份原始 payload 原样**,
   * 上面带着 `model`(供应商型号名)与 `reason`。商家可见的任何 JSON 里都不许有型号
   * (Founder 常令:provider 保密),而刷新那条正路(`toChatMessageDTO`)一直在剥它 ——
   * 这道闸等于开了第二条不剥的路。现在两条路共用同一个函数(`genCardPayloadDTO`)。
   */
  it("creation §5 :170 FSE-012 拒绝时交回的那张卡走刷新那条同一条剥离:型号与理由不随它回到浏览器", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const staleVersion = cardQuoteVersion(card.payload);
    await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });

    // 库里那张卡上**确实**带着型号 —— 下面那几句因此不是「本来就没有」。
    const persisted = (await persistedCard(world, card.cardId)) as unknown as Record<string, unknown>;
    const modelInDb = persisted.model;
    expect(typeof modelInDb).toBe("string");

    const res = await pressGenerate(world, card.cardId, card.payload, staleVersion);

    expect(res).toMatchObject({ error: QUOTE_VERSION_STALE });
    const quote = (res as { quote?: unknown }).quote as Record<string, unknown>;
    expect(quote.model).toBeUndefined();
    expect(quote.reason).toBeUndefined();
    // 整份 JSON 扫一遍:型号名不许以任何一格的身份混在里面。
    expect(JSON.stringify(quote)).not.toContain(modelInDb as string);
    // 剥完仍然是一张画得出来的卡 —— 剥离不能把刷新这件事本身弄坏。
    expect(parsePlanCardPayload(quote)).not.toBeNull();
    expect(quote.estimatedCredits).toBe(persisted.estimatedCredits);
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
    // 判官第 3 轮 P2-c —— 第二条路交回的那张卡走的也是刷新那条同一条剥离:零型号、零理由。
    expect((quote as unknown as Record<string, unknown>).model).toBeUndefined();
    expect((quote as unknown as Record<string, unknown>).reason).toBeUndefined();
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
    // 判官第 3 轮 P1 —— 上一版这里写的是 `refId === \`reserve:${first.id}\``,而 `reserveCredits`
    // 写进账本那一行的 refId **就是传进去的那一个**(任务行 id),`reserve:<refId>` 是它的
    // 幂等键、从来不进 refId 这一格。于是那个 filter 恒为空集、断言恒真,什么也没证明。
    // 真断言按真实形状写:这张卡背后那一笔生成费**有且只有一笔**,任务行也只有一行。
    const rows = await ledgerRows(world.ownerId);
    expect(rows.filter((r) => r.refId === first.id)).toHaveLength(1);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(1);
  });

  /**
   * 门口那道闸只能证明**按下按钮那一刻**卡还是他看的那一版。恢复轮里 `generate` 技能会按
   * 它自己那次读到的卡把整份请求重拼一遍(价钱因此自洽在**新**的那一版上,两道价格对签谁
   * 也拦不住)—— 所以「他批的是哪一版」必须**一路带进去**,由那一步再比一次(判官第 3 轮 P2-b)。
   * 这一条钉的是「带进去了」;「带进去之后真的拦得住」由 `packages/otto/src/skills/generate.test.ts`
   * 那两条钉住(那里 `ctx.startGen` 是唯一花钱的出口,断言它一次都没被调用)。
   */
  it("creation §5 :170 FSE-012 ottoApprove 把商家批的那一版随 ctx 交进恢复轮(执行那一步据此再比一次)", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await armApprovalResume(world, card.cardId);
    const approved = cardQuoteVersion(card.payload);

    await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    expect(capturedResumeCtx?.approvedQuoteVersion).toEqual({ cardId: card.cardId, version: approved });
  });

  /**
   * 判官第 4 轮 P1 —— **恢复轮里那道迟到的拒绝，不许被外层说成一次成功的批准。**
   *
   * 上面那条钉的是「批的那一版带进去了」，`packages/otto/src/skills/generate.test.ts` 钉的是
   * 「带进去之后 `startGen` 一次都没被调用」。中间还剩一段没人钉：那道闸拒绝之后，工具的
   * 拒绝只回到模型（`skill.ts` 原样返回、不中止恢复轮），恢复轮照样跑完 —— 从前 `ottoApprove`
   * 一律返回 `{ ok: true, status: "done" }`，`plan-approval.ts` 读不到 `error`，`OttoPlanCard`
   * 于是调 `onApproved`：**商家被告知批准成功，而什么都没生成。**
   *
   * 这一条布置的就是那一刻：门口那道闸放行（按下按钮时卡还是他看的那一版），卡在**恢复轮
   * 跑着的时候**被改，而恢复轮里**真的把 `generate` 技能跑了一遍**（`runGenerate`）——
   * 拒绝因此是那道闸自己拒的，不是外层看着「这张卡没有任务行」推断出来的（判官第 5 轮
   * P2-a：那个推断在「同一轮生成了别的卡」时会说谎，见本文件末那一组）。断言分两半：
   *   · 交回商家的必须是那句拒绝 ＋ 刷新后的那张卡（与另一条批准路同一个形状）；
   *   · 生成那一笔真的没花（零任务行、零生成预扣），而这一轮的**对话花费**照旧发生 ——
   *     恢复轮真的跑过，这道闸不假装它没跑（PR「未做」里写的就是这一条）。
   */
  it("creation §5 :170 FSE-012 恢复轮跑着的时候卡被改:那一趟不许被说成批准成功,交回拒绝与刷新后的报价", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    // 门口那道闸放行(按下按钮那一刻卡没变);改档发生在**恢复轮里面**,而那一轮真的跑技能。
    await armApprovalResume(world, card.cardId, {
      runGenerate: true,
      duringResume: async () => {
        const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
        if ("error" in rebuilt) throw new Error(`恢复轮里改档被拒:${rebuilt.error}`);
      },
    });

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    // 恢复轮**真的跑过** —— 这一条与门口那道闸的用例正好相反,拒绝是迟到的那一种。
    expect(mockRunOttoTurn).toHaveBeenCalledTimes(1);
    // 不许再说 ok:true。交回的是那句拒绝 ＋ 刷新后的那张卡。
    expect(res).toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(res).not.toMatchObject({ ok: true });
    const quote = (res as { quote?: unknown }).quote as CardPayload;
    expect(quote.params.count).toBe(2);
    expect(quote.estimatedCredits).toBe((await persistedCard(world, card.cardId)).estimatedCredits);
    // 交回浏览器那一份走的是同一条剥离:零型号(provider 保密)。
    expect((quote as unknown as Record<string, unknown>).model).toBeUndefined();
    // 生成那一笔真的没花:零任务行。
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // 诚实边界:这一轮的对话花费**确实发生了**(恢复轮跑过),这道闸不假装它没跑。
    expect(resumeReserveRows(await ledgerRows(world.ownerId), world, card.cardId)).toHaveLength(1);
  });

  /**
   * 上一条的反面 —— 迟到那道闸**不许拦下一次已经成交的批准**。恢复轮里生成真的建了任务行
   * （同一个幂等键 `cowork:<cardId>`），那一趟花过钱、拿到了东西，说成「价变了」就是把一次
   * 成功说成失败。
   *
   * 卡上那份报价的漂移在这里是**直接改库造出来的**，而不是走 `ottoUpdateGenCardOptions`：
   * 那条产品路在卡挂上任务行之后自己就会拒绝（"This one's already under way"，实测），所以
   * 今天没有一条商家能走的路能造出这个状态。直接改库是为了把这道闸的判据本身钉住 ——
   * 将来若有第二条重铸路绕过那句拒绝，一次**已经付过钱**的批准也不许被翻译成「价变了」。
   */
  it("creation §5 :170 FSE-012 恢复轮真的建了任务行:即使卡上那份报价漂了,那一趟照旧是一次成功的批准", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    await armApprovalResume(world, card.cardId, { duringResume: async () => {
      // 恢复轮里那一步真的花了钱、建了任务行(同一个幂等键 `cowork:<cardId>`)。
      const started = await pressGenerate(world, card.cardId, card.payload, approved);
      if ("error" in started) throw new Error(`恢复轮里的生成被拒:${started.error}`);
      // 报价漂移(见上面的文注:今天只有直接改库造得出来)。
      const persisted = (await persistedCard(world, card.cardId)) as unknown as Record<string, unknown>;
      const drifted = {
        ...persisted,
        params: { ...(persisted.params as Record<string, unknown>), count: 2 },
        estimatedCredits: (persisted.estimatedCredits as number) * 2,
      };
      await prisma.chatMessage.update({ where: { id: card.cardId }, data: { payload: drifted as object } });
      expect(cardQuoteVersion(drifted)).not.toBe(approved);
    } });

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    expect(res).not.toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(res).toMatchObject({ ok: true, status: "done" });
    expect((res as { genJobId?: string }).genJobId).toBeTruthy();
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(1);
  });

  it("creation §5 :170 FSE-012 ottoApprove 不带版本:恢复轮拿到的 ctx 上没有这一格(缺席＝放行,与从前逐字相同)", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    await armApprovalResume(world, card.cardId);

    await ottoApprove({ threadId: world.threadId, cardId: card.cardId });

    expect(capturedResumeCtx?.approvedQuoteVersion).toBeUndefined();
  });
});

/**
 * 验收 R1（Founder 裁决原文，规格 §5 :170）——「旧报价提交即**拒绝并刷新**；不锁控件」。
 *
 * 前四轮把「拒绝」做到了，「并刷新、可再批」没有：拒绝之后商家按下**同一颗按钮**再提交，
 * 服务端回的是 `That card isn't awaiting approval.` —— 那张停下来等批准的卡在拒绝那一趟里
 * 被恢复轮消费掉了，于是「刷新」变成了「这条路走不通了，请重开一局」。这一组用例把那句
 * 裁决整句钉住：**拒 → 换新价 → 同一颗按钮再按一次 → 真的成交，而且只成交一次。**
 *
 * 三条路各钉一遍，因为「按钮」在商家眼里只有一颗、在代码里有三种结局：
 *   · 提议卡（`coworkGenerate`）；
 *   · 停下来等批准的卡、**门口**就被拒（`ottoApprove` 那道闸）；
 *   · 停下来等批准的卡、**恢复轮里迟到**才被拒（`generate` 技能在 `ctx.startGen` 之前拒）。
 *
 * 后两条这一轮起在恢复轮里**真的把 `generate` 技能跑一遍**（`runGenerate`）：拒绝是那个技能
 * 自己拒的，成交是它自己经 `ctx.startGen` 花的钱。「再按一次就成功」因此不是替身说了算。
 */
describe("creation §5 :170 FSE-012 R1 拒绝之后,同一颗按钮再按一次就成交(且只成交一次)", () => {
  it("creation §5 :170 FSE-012 R1 提议卡:旧报价被拒 → 拿交回的那张卡再按一次 → 成交,恰一次预扣", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const staleVersion = cardQuoteVersion(card.payload);
    const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
    if ("error" in rebuilt) throw new Error(`改档被拒:${rebuilt.error}`);

    const refused = await pressGenerate(world, card.cardId, card.payload, staleVersion);
    expect(refused).toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(await ledgerRows(world.ownerId)).toHaveLength(0);

    // 卡面换成交回来的那一份(`onOptionsChanged` 那条路),商家看到新价,按下同一颗按钮。
    // 送出去的一切都从**那一份**来 —— 与 `plan-approval.ts` 逐字同一条路。
    const refreshed = parsePlanCardPayload((refused as { quote?: unknown }).quote);
    expect(refreshed).not.toBeNull();
    const again = await pressGenerate(
      world,
      card.cardId,
      refreshed!.value as unknown as CardPayload,
      cardQuoteVersion(refreshed!.value),
    );

    if ("error" in again) throw new Error(`刷新之后再按一次仍被拒:${again.error}`);
    const rows = await ledgerRows(world.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("RESERVE");
    expect(rows[0]!.refId).toBe(again.id);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(1);
  });

  it("creation §5 :170 FSE-012 R1 等批准的卡在门口被拒:同一颗按钮再按一次 → 恢复轮真的生成,恰一次生成预扣", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const staleVersion = cardQuoteVersion(card.payload);
    await armApprovalResume(world, card.cardId, { runGenerate: true });
    const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
    if ("error" in rebuilt) throw new Error(`改档被拒:${rebuilt.error}`);

    const refused = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: staleVersion });
    expect(refused).toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);

    const again = await ottoApprove({
      threadId: world.threadId,
      cardId: card.cardId,
      quoteVersion: clientQuoteVersionOf((refused as { quote?: unknown }).quote),
    });

    expect(again).toMatchObject({ ok: true, status: "done" });
    const jobId = (again as { genJobId?: string }).genJobId;
    expect(jobId).toBeTruthy();
    const rows = await ledgerRows(world.ownerId);
    expect(rows.filter((r) => r.kind === "RESERVE" && r.refId === jobId)).toHaveLength(1);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(1);
  });

  /**
   * 这一条就是前四轮补丁打在表面上的那处：迟到的拒绝**发生在卡被消费之后**，于是商家听到
   * 「价变了，这是新价」，再按一次却得到「That card isn't awaiting approval.」——「刷新」
   * 那一半在这条路上从来没成立过。拒绝必须发生在任何会改卡状态／消费卡的动作之前。
   */
  it("creation §5 :170 FSE-012 R1 恢复轮里迟到的拒绝:那张卡仍等着批准,同一颗按钮再按一次就真的生成", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    let drifted = false;
    await armApprovalResume(world, card.cardId, {
      runGenerate: true,
      // 只漂一次:第二次点击面对的是一张安静的卡(商家已经看过新价了)。
      duringResume: async () => {
        if (drifted) return;
        drifted = true;
        const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
        if ("error" in rebuilt) throw new Error(`恢复轮里改档被拒:${rebuilt.error}`);
      },
    });

    const refused = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    expect(refused).toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // 拒绝**什么都没消费**:那张卡仍然停在等批准的位置上。
    const parked = await prisma.chatThread.findFirstOrThrow({ where: { id: world.threadId, ownerId: world.ownerId } });
    expect(parked.ottoState).toBe(PAUSED_STATE);

    const again = await ottoApprove({
      threadId: world.threadId,
      cardId: card.cardId,
      quoteVersion: clientQuoteVersionOf((refused as { quote?: unknown }).quote),
    });

    expect(again).toMatchObject({ ok: true, status: "done" });
    const jobId = (again as { genJobId?: string }).genJobId;
    expect(jobId).toBeTruthy();
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(1);
    const rows = await ledgerRows(world.ownerId);
    expect(rows.filter((r) => r.kind === "RESERVE" && r.refId === jobId)).toHaveLength(1);
  });
});

/**
 * 判官第 5 轮 P2 的两条，都在同一处：**「这一趟到底发生了什么」不许靠猜。**
 *
 *  a) 迟到那道闸从前的判据是「这张卡上有没有任务行」(`if (!genJob)`)。同一轮恢复里模型
 *     生成了**别的**卡时，这张卡当然没有任务行 —— 于是一次与报价毫无关系的恢复轮被说成
 *     「价变了」，`onApproved` 也不再调用。判据改成**这一张卡是不是真的被那道闸拒了**
 *     （`generate` 技能自己报上来的事实，不是外层的推断）。
 *  b) `needs_approval` 那个终局分支从前一律 `ok:true`：报价被拒的那张卡照样被父层标成
 *     已批准。返回体必须能把「这张被拒」与「已批准、但停在别的批准上」分开说，
 *     而 `pendingCardIds` 照带（返回的是一个对象，两件事不冲突）。
 */
describe("creation §5 :170 FSE-012 恢复轮的结局按真事实判定,不按「有没有任务行」猜", () => {
  it("creation §5 :170 FSE-012 同一轮恢复生成的是别的卡:这张卡没有任务行也不许被说成价变了", async () => {
    const world = await seedWorld(500);
    const approvedCard = await mintImageCard(world);
    const otherCard = await mintImageCard(world);
    const approved = cardQuoteVersion(approvedCard.payload);
    let done = false;
    await armApprovalResume(world, approvedCard.cardId, {
      duringResume: async () => {
        if (done) return;
        done = true;
        // 恢复轮生成的是**另一张**卡(模型自己挑的),被批准的这一张一行任务都没有。
        const started = await pressGenerate(world, otherCard.cardId, otherCard.payload, cardQuoteVersion(otherCard.payload));
        if ("error" in started) throw new Error(`别的卡的生成被拒:${started.error}`);
        // 与此同时被批准的这一张漂了 —— 「有没有任务行」这个判据在这里会说谎。
        const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: approvedCard.cardId, count: 2 });
        if ("error" in rebuilt) throw new Error(`改档被拒:${rebuilt.error}`);
      },
    });

    const res = await ottoApprove({ threadId: world.threadId, cardId: approvedCard.cardId, quoteVersion: approved });

    // 这一趟里那道闸一次都没拒过这张卡,所以不许交回「价变了」。
    expect(res).not.toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(res).toMatchObject({ ok: true });
  });

  it("creation §5 :170 FSE-012 恢复轮拒了这张卡、又停在别的批准上:两件事分开说,pendingCardIds 照带", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const nextCard = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    let drifted = false;
    await armApprovalResume(world, card.cardId, {
      runGenerate: true,
      parkAgainOnCardId: nextCard.cardId,
      duringResume: async () => {
        if (drifted) return;
        drifted = true;
        const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
        if ("error" in rebuilt) throw new Error(`恢复轮里改档被拒:${rebuilt.error}`);
      },
    });

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    // 停在别的批准上这件事照说 —— 链上那张卡的 id 一个不少。
    expect(res).toMatchObject({ ok: true, status: "needs_approval" });
    expect((res as { pendingCardIds?: string[] }).pendingCardIds).toContain(nextCard.cardId);
    // 而这一张**是被拒的**,不许被父层标成已批准:同一句拒绝 ＋ 刷新后的那张卡。
    const stale = (res as { staleQuote?: { error: string; quote: unknown } }).staleQuote;
    expect(stale?.error).toBe(QUOTE_VERSION_STALE);
    expect((stale?.quote as Record<string, unknown> | undefined)?.model).toBeUndefined();
    expect(((stale?.quote as { params?: { count?: number } } | undefined)?.params)?.count).toBe(2);
    // 生成那一笔没花。
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
  });
});

/**
 * 判官第 3 轮 P2-c 的第二道:行为用例证明**今天**交回去的那份是干净的,这一条证明**明天**
 * 没人能悄悄把它换回原始 payload —— 商家可见 JSON 里出现型号名是家规级事故(provider 保密),
 * 而它离「少写一个函数调用」只有一步。
 */
describe("creation §5 :170 FSE-012 交回浏览器那一份的剥离只有一条路(源码闸)", () => {
  it("creation §5 :170 FSE-012 `card-quote-version.ts` 交回的 quote 必须过 genCardPayloadDTO,不许原样吐 payload", () => {
    const src = readFileSync(new URL("../card-quote-version.ts", import.meta.url), "utf8");
    expect(src).toMatch(/genCardPayloadDTO\(card\.payload\)/);
    // 原样交回库里那份的写法(任何形式的 `quote: card.payload`)不许出现。
    expect(src).not.toMatch(/quote:\s*card\.payload/);
  });
});

/**
 * 判官第 6 轮的四条，都在同一处根因上：**那道闸报上来的判决，外层读得全不全。**
 *
 * 第 5 轮把「这一趟到底发生了什么」从推断改成事实（`ctx.approvedQuoteVersion.refused`），
 * 但那一格只**置**不**清**、只覆盖闸自己那一次比对、而且只有两个终局分支去读它。于是同一
 * 个事实在三个地方各说各话：
 *   · 同一趟里「先被拒、随后同一张卡真的生成成功」⇒ 仍按被拒返回，而任务行与预扣已经落地；
 *   · 拒绝发生在**下游**（`startGen` 事务里那次逐字复读）⇒ 一格都没置，那一趟被说成成功；
 *   · 恢复轮撞上步数上限／CAS 输了 ⇒ 两个出口都在读那一格之前就 `ok:true` 走了。
 */
describe("creation §5 :170 FSE-012 判官第 6 轮:那道闸的判决,三个出口读的是同一个事实", () => {
  it("creation §5 :170 FSE-012 同一趟恢复里先被拒、随后同一张卡真的生成成功:不许再按被拒返回", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    let played = false;
    await armApprovalResume(world, card.cardId, {
      // 恢复轮里模型对工具错误重试一次:同一轮里第二次调用 `generate`。
      // 商家在这中间把那一格改回去（不锁控件 ⇒ 他改得动），版本于是重新对上。
      duringResume: async () => {
        if (played) return;
        played = true;
        const ctx = capturedResumeCtx as never;
        const up = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
        if ("error" in up) throw new Error(`改档被拒:${up.error}`);
        const first = await executeGenerate({ cardId: card.cardId }, { context: ctx } as never);
        expect(first).toMatchObject({ error: QUOTE_VERSION_STALE });
        const back = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 1 });
        if ("error" in back) throw new Error(`改回去被拒:${back.error}`);
        expect(cardQuoteVersion(await persistedCard(world, card.cardId))).toBe(approved);
        const second = await executeGenerate({ cardId: card.cardId }, { context: ctx } as never);
        expect(second).toMatchObject({ status: "queued" });
      },
    });

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    // 生成真的发生了(一行任务、一笔生成预扣) —— 这一趟不许被说成「价变了、什么都没生成」。
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(1);
    expect(res).not.toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(res).toMatchObject({ ok: true, status: "done" });
    expect((res as { genJobId?: string }).genJobId).toBeTruthy();
  });

  it("creation §5 :170 FSE-012 拒绝发生在下游那次逐字复读(卡在闸与钱事务之间被改):那一趟也不许被说成成功", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    // 那道闸读卡之后、钱事务之前的那一格窗口:守望者这一步就在窗口里(`gen-actions.ts`
    // 的 checkCast 排在 `prisma.$transaction` 之前),用它把并发重铸演到那一刻。
    (checkCast as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
      if ("error" in rebuilt) throw new Error(`窗口里改档被拒:${rebuilt.error}`);
      return null;
    });
    await armApprovalResume(world, card.cardId, { runGenerate: true });

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    // 钱事务在 create/reserve 之前就拒了:零任务行。
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // 而商家听到的必须是那句拒绝 ＋ 刷新后的那张卡,不是 `status:"done"`。
    expect(res).toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(res).not.toMatchObject({ ok: true });
    expect(((res as { quote?: { params?: { count?: number } } }).quote?.params)?.count).toBe(2);
  });

  it("creation §5 :170 FSE-012 恢复轮撞上步数上限:被拒的那一张不许被 degraded 吞成成功,停车位还在", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    let drifted = false;
    await armApprovalResume(world, card.cardId, {
      runGenerate: true,
      duringResume: async () => {
        if (drifted) return;
        drifted = true;
        const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
        if ("error" in rebuilt) throw new Error(`恢复轮里改档被拒:${rebuilt.error}`);
      },
      // 被拒之后模型继续兜圈子,撞上步数上限 —— 那一支从前直接 `ok:true, status:"degraded"`。
      throwAfterGenerate: () => {
        const e = new MaxTurnsExceededError("Max turns exceeded");
        (e as unknown as { state: { toString(): string } }).state = { toString: () => "{after-resume}" };
        return e;
      },
    });

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    expect(res).toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(res).not.toMatchObject({ ok: true });
    expect(((res as { quote?: { params?: { count?: number } } }).quote?.params)?.count).toBe(2);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
    // 「拒绝并刷新」的后半句在这一支也要成立:停车位没被那份截断状态盖掉,同一颗按钮再按一次就成交。
    const parked = await prisma.chatThread.findFirstOrThrow({ where: { id: world.threadId, ownerId: world.ownerId } });
    expect(parked.ottoState).toBe(PAUSED_STATE);
  });

  it("creation §5 :170 FSE-012 恢复轮又停在别的批准上而 CAS 输了:被拒的那一张不许被 stale 吞成成功", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world);
    const nextCard = await mintImageCard(world);
    const approved = cardQuoteVersion(card.payload);
    let drifted = false;
    await armApprovalResume(world, card.cardId, {
      runGenerate: true,
      parkAgainOnCardId: nextCard.cardId,
      duringResume: async () => {
        if (drifted) return;
        drifted = true;
        const rebuilt = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: card.cardId, count: 2 });
        if ("error" in rebuilt) throw new Error(`恢复轮里改档被拒:${rebuilt.error}`);
        // 另一趟对话在同一条线程上写了新状态 ⇒ 下面那次 CAS 一定输。
        await prisma.chatThread.updateMany({
          where: { id: world.threadId, ownerId: world.ownerId },
          data: { ottoState: "{moved-by-another-turn}" },
        });
      },
    });

    const res = await ottoApprove({ threadId: world.threadId, cardId: card.cardId, quoteVersion: approved });

    expect(res).toMatchObject({ error: QUOTE_VERSION_STALE });
    expect(res).not.toMatchObject({ ok: true });
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(0);
  });
});
