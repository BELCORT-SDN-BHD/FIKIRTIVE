/**
 * creation-multi-reference-card —— 挂几张、卡上列几条、任务带几条(Codex staging 走查
 * CRE-STG-P0-001 / P1-003 / P2-004,2026-09-04)。
 *
 * 规格 `docs/specs/creation-engine.md`,验收 **CREATE-A1**(花钱前看得见)与
 * **CREATE-A2**(素材指派:图＝产品参考、视频＝镜头参考;越出该素材的合法角色 ⇒
 * 花钱前诚实拒绝并说明原因、ledger 零新增行)。
 *
 * ── 走查那一轮发生了什么 ──────────────────────────────────────────────────
 * composer 上两个芯片都在(人物 + 产品),Otto 说两张都收到了,而 starting-image 确认卡
 * 只列得出一件(`a women From My Videos`),按 `Generate · 1 credit` 两次都回同一句
 * `Couldn't start that - please try again.` —— 没有 job、没有输出、账本零扣费,也没有
 * 任何一个把三方(商家屏幕 / 服务端日志 / 走查报告)串起来的把手。
 *
 * ── 这一份钉住什么 ────────────────────────────────────────────────────────
 *   · CREATE-A1:两张挂图 ⇒ 卡上**两条**回执,各带角色(`Base image` / `Reference`),
 *     GenJob 两个 id 都在,ledger 恰一组;
 *   · CREATE-A1:一击恰一个 job,重试复用同一个(`cowork:<cardId>` 幂等),不二次扣费;
 *   · CREATE-A2:视频塞进图片那一格 ⇒ 拒绝说的是「这是一支视频」而不是「找不到」,
 *     零 GenJob、ledger 零新增行;
 *   · CREATE-A2:图片计划挂着整段参考片 ⇒ **铸卡之前**拒绝,一张 GEN_CARD 都不落库;
 *   · CREATE-A1:批准失败读到的是单一措辞源那一句 + 一个可复制短号(不含 id/URL/路径/堆栈)。
 *
 * 真 Postgres(*_test)、真 Prisma、真本地存储、真 credit ledger(经真 `startCoworkGen`)。
 * 零 provider 调用、零花费。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  buildGenRequestFromCard,
  referenceUnavailableMessage,
  GENERATION_START_FAILED,
  diagnosticRef,
  cardReferenceRoleLabel,
} from "@fikirtive/core";
import { buildProposeCard, ProposeRefusal, type CardPayload, type OttoContext } from "@fikirtive/otto";

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
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));
// CRE-STG-P2-004 —— 卡面那一层读的是 `runPlanApproval` 的返回值,所以那两个服务端动作在这
// 里被替掉:本例要钉的是「动作抛了之后商家手上剩什么」,不是动作自己的逻辑。两者在本文件
// 的其余用例里都没有被用到(付费那几条走的是真的 `startCoworkGen`)。
const mockCoworkGenerate = vi.fn();
vi.mock("@/lib/cowork-actions", () => ({ coworkGenerate: (...a: unknown[]) => mockCoworkGenerate(...a) }));
vi.mock("@/lib/otto-client-actions", () => ({ ottoApprove: vi.fn() }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: vi.fn() }));

const { validateOttoTurnReferences, unavailableReferenceMessage } = await import("../otto-actions");
const { startCoworkGen } = await import("../gen-actions");
const { storage } = await import("../storage");
const { prisma } = await import("@fikirtive/db");
const { planCardGate } = await import("@/components/otto/plan-card-contract");
const { runPlanApproval } = await import("@/components/otto/plan-approval");

const INTERNAL_PER_DISPLAY_BALANCE = 500_000;
const PRODUCT_PROMPT = "A brushed steel tumbler on marble";
const PERSON_PROMPT = "a women";

type Shop = { ownerId: string; canvasA: string; canvasB: string; threadId: string };

async function seedShop(): Promise<Shop> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance: INTERNAL_PER_DISPLAY_BALANCE, reserved: 0 } });
  const canvasA = `prj_${randomUUID()}`;
  const canvasB = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: canvasA, ownerId, name: "My Videos" } });
  await prisma.project.create({ data: { id: canvasB, ownerId, name: "Raya campaign" } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId: canvasB, title: "Otto" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, canvasA, canvasB, threadId };
}

/** 一件真的、字节真的落在本地存储里的生成物。 */
async function seedGeneration(
  ownerId: string,
  projectId: string,
  prompt: string,
  ext: "png" | "mp4",
): Promise<string> {
  const bytes = new Uint8Array([0x89, 0x50, ...randomUUID().split("").map((c) => c.charCodeAt(0))]);
  const { contentHash } = await storage.put(ownerId, bytes, ext);
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId,
      ownerId,
      contentHash,
      ext,
      mime: ext === "png" ? "image/png" : "video/mp4",
      sizeBytes: BigInt(bytes.length),
      source: "GENERATED",
    },
  });
  const generationId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: generationId,
      ownerId,
      projectId,
      shotId: null,
      assetId,
      source: "GENERATED",
      promptText: prompt,
      entitySnapshot: { entities: [] },
    },
  });
  return generationId;
}

function ottoCtx(over: Partial<OttoContext> & { orgId: string; projectId: string; threadId: string }): OttoContext {
  return { userId: "user-test", disabledModels: [], sourceGenerationId: null, ...over } as OttoContext;
}

/** Otto 铸的那张 9:16 图片确认卡,原样落库。 */
async function mintImageCard(
  shop: Shop,
  ctxOver: Partial<OttoContext>,
): Promise<{ cardId: string; payload: CardPayload }> {
  const { cardPayload } = buildProposeCard(
    {
      kind: "image",
      structuredPrompt: "Put my tumbler in her hands",
      entityIds: [],
      variantSel: {},
      count: 1,
      desiredAspect: "9:16",
    },
    ottoCtx({ orgId: shop.ownerId, projectId: shop.canvasB, threadId: shop.threadId, ...ctxOver }),
    [],
  );
  const cardId = `msg_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId: shop.threadId,
      ownerId: shop.ownerId,
      role: "AGENT",
      kind: "GEN_CARD",
      seq: 1,
      text: "",
      payload: cardPayload as unknown as object,
    },
  });
  return { cardId, payload: cardPayload };
}

async function ledgerRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CREATE-A1 两张挂图 + 9:16:卡上两条回执,任务带两条", () => {
  it("CREATE-A1 产品图与人物图都进卡面回执、都带角色,GenJob 两个 id 都在,账本恰一组", async () => {
    const shop = await seedShop();
    const product = await seedGeneration(shop.ownerId, shop.canvasB, PRODUCT_PROMPT, "png");
    const person = await seedGeneration(shop.ownerId, shop.canvasA, PERSON_PROMPT, "png");

    // ① 解析:两张都解得出来,两条回执。
    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [product, person],
    });
    expect(refs.unavailable).toEqual([]);
    expect(refs.sourceGenerationIds).toEqual([product, person]);

    // ② 铸卡:走查那一天这里只剩一条 —— 现在两条,次序 = 商家挂的次序。
    const card = await mintImageCard(shop, {
      sourceGenerationId: refs.sourceGenerationIds[0],
      sourceGenerationIds: refs.sourceGenerationIds,
      mediaReferences: refs.mediaReferences,
    });
    expect(card.payload.mediaReferences?.map((r) => r.generationId)).toEqual([product, person]);
    expect(card.payload.sourceGenerationId).toBe(product);
    expect(card.payload.referenceGenerationIds).toEqual([person]);

    // ③ 角色:商家读得到「哪一件坐哪一格」,而不是两行长得一样的名字。
    expect(card.payload.mediaReferences?.map((r) => r.role)).toEqual(["baseImage", "reference"]);
    expect(card.payload.mediaReferences?.map((r) => cardReferenceRoleLabel(r.role))).toEqual([
      "Base image",
      "Reference",
    ]);
    // 名字与出处照旧由服务端产出(卡面不猜)。
    expect(card.payload.mediaReferences?.map((r) => r.label)).toEqual([PRODUCT_PROMPT, PERSON_PROMPT]);
    expect(card.payload.mediaReferences?.[1]?.sourceProjectName).toBe("My Videos");

    // ④ 前端那道门:两条回执都齐 ⇒ 可批准(缺一条就不许花钱)。
    const gate = planCardGate(card.payload);
    expect(gate.missingReferenceReceipts).toEqual([]);
    expect(gate.approvable).toBe(true);

    // ⑤ 批准:GenJob 两个 id 都在,形状是商家点的那一格。
    const built = buildGenRequestFromCard({
      cardPayload: card.payload,
      projectId: shop.canvasB,
      threadId: shop.threadId,
      cardId: card.cardId,
      entityIds: card.payload.entityIds,
      variantSel: card.payload.variantSel,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.error);
    const result = await startCoworkGen(built.req);
    expect(result).not.toHaveProperty("error");
    if ("error" in result) throw new Error(result.error);
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: result.id, ownerId: shop.ownerId },
      select: { sourceGenerationId: true, imageOptions: true },
    });
    expect(job.sourceGenerationId).toBe(product);
    expect((job.imageOptions as { referenceGenerationIds?: string[] }).referenceGenerationIds).toEqual([person]);
    expect((job.imageOptions as { aspectRatio?: string }).aspectRatio).toBe("9:16");

    // ⑥ 账本:恰一组(一次预扣),不是两组、不是零组。
    const rows = await ledgerRows(shop.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refId).toContain(result.id);
  });

  it("CREATE-A1 一击恰一个 job:重试同一张卡复用它,不再扣第二次", async () => {
    const shop = await seedShop();
    const product = await seedGeneration(shop.ownerId, shop.canvasB, PRODUCT_PROMPT, "png");
    const person = await seedGeneration(shop.ownerId, shop.canvasA, PERSON_PROMPT, "png");
    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [product, person],
    });
    const card = await mintImageCard(shop, {
      sourceGenerationId: refs.sourceGenerationIds[0],
      sourceGenerationIds: refs.sourceGenerationIds,
      mediaReferences: refs.mediaReferences,
    });
    const build = () => {
      const built = buildGenRequestFromCard({
        cardPayload: card.payload,
        projectId: shop.canvasB,
        threadId: shop.threadId,
        cardId: card.cardId,
        entityIds: card.payload.entityIds,
        variantSel: card.payload.variantSel,
      });
      if (!built.ok) throw new Error(built.error);
      return built.req;
    };

    const first = await startCoworkGen(build());
    const second = await startCoworkGen(build());
    if ("error" in first) throw new Error(first.error);
    if ("error" in second) throw new Error(second.error);

    // 同一个 job,第二次是复用而不是新建 —— 幂等身份是 `cowork:<cardId>`。
    expect(second.id).toBe(first.id);
    expect(second.disposition).toBe("reused");
    expect(await prisma.genJob.count({ where: { ownerId: shop.ownerId } })).toBe(1);
    // 账本仍然恰一组:重试不是第二次花钱。
    expect(await ledgerRows(shop.ownerId)).toHaveLength(1);
  });
});

describe("CREATE-A2 挂错了类型:说出是哪一种,而不是「找不到」", () => {
  it("CREATE-A2 一支视频被塞进图片那一格:拒绝句说的是视频,零 GenJob、ledger 零新增行", async () => {
    const shop = await seedShop();
    const clip = await seedGeneration(shop.ownerId, shop.canvasA, "a women walking", "mp4");

    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [clip],
    });

    expect(refs.unavailable).toEqual([{ id: clip, reason: "videoAsImage" }]);
    expect(unavailableReferenceMessage(refs.unavailable)).toBe(referenceUnavailableMessage("videoAsImage"));
    // 走查读到的那句「isn't available any more」是假的:那支片子就在他的 Library 里。
    expect(unavailableReferenceMessage(refs.unavailable)).not.toBe(referenceUnavailableMessage("notFound"));
    expect(unavailableReferenceMessage(refs.unavailable)).toMatch(/video can't be used as a reference for an image/i);
    // 措辞里不许出现 id、路径或别家账号的存在与否。
    expect(unavailableReferenceMessage(refs.unavailable)).not.toContain(clip);

    expect(refs.sourceGenerationIds).toEqual([]);
    expect(await prisma.genJob.count({ where: { ownerId: shop.ownerId } })).toBe(0);
    expect(await ledgerRows(shop.ownerId)).toEqual([]);
  });

  it("CREATE-A2 同一支片子放对了格子照旧可用 —— 拒绝的是错格,不是这件素材", async () => {
    const shop = await seedShop();
    const clip = await seedGeneration(shop.ownerId, shop.canvasA, "a women walking", "mp4");

    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      referenceVideoGenerationIds: [clip],
    });

    expect(refs.unavailable).toEqual([]);
    expect(refs.referenceVideoGenerationIds).toEqual([clip]);
    expect(refs.mediaReferences.map((r) => r.kind)).toEqual(["video"]);
  });

  it("CREATE-A2 图片计划挂着整段参考片:铸卡之前拒绝,一张 GEN_CARD 都不落库、ledger 零新增行", async () => {
    const shop = await seedShop();
    const clip = await seedGeneration(shop.ownerId, shop.canvasA, "a women walking", "mp4");
    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      referenceVideoGenerationIds: [clip],
    });

    // 走查之前这里**不抛**:卡照铸,只是一个字都不提那支片子 —— 商家为一张与它无关的图付钱。
    // 认的是**基类** `ProposeRefusal`:入口(`executePropose`)只认识「这是一次拒绝」,
    // 所以这一条同时证明了新拒绝真的会被那个 catch 接住,而不是变成一次崩溃。
    const refusal = await mintImageCard(shop, {
      referenceVideoGenerationId: refs.referenceVideoGenerationIds[0],
      referenceVideoGenerationIds: refs.referenceVideoGenerationIds,
      mediaReferences: refs.mediaReferences,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(ProposeRefusal);
    // 同一件事在两个时刻只有一种说法:发送前那道闸与铸卡这道闸共用同一句。
    expect((refusal as Error).message).toBe(referenceUnavailableMessage("videoAsImage"));

    expect(await prisma.chatMessage.count({ where: { ownerId: shop.ownerId, kind: "GEN_CARD" } })).toBe(0);
    expect(await prisma.genJob.count({ where: { ownerId: shop.ownerId } })).toBe(0);
    expect(await ledgerRows(shop.ownerId)).toEqual([]);
  });
});

describe("CREATE-A1 批准失败读得懂", () => {
  it("CREATE-A1 泛化句来自单一措辞源,不含 id、URL、路径或堆栈", () => {
    // 走查那句 `Couldn't start that - please try again.` 是客户端 catch 里的字面量,
    // 措辞源里根本没有它 —— 现在有了,而且只有这一份。
    expect(GENERATION_START_FAILED).toMatch(/nothing was charged/i);
    expect(GENERATION_START_FAILED).not.toMatch(/https?:|\/|Error|at\s+\w+\.|gen_|msg_/);
  });

  it("CREATE-A1 短号由那次动作自己的身份算出来,两边同一个函数、同一串", () => {
    const cardId = "msg_2f4c1a9e-77b1-4f0a-9d2e-a1b2c3d4e5f6";
    const ref = diagnosticRef(cardId);
    expect(ref).toBe(diagnosticRef(cardId)); // 纯函数:服务端日志与卡面算出同一串
    expect(ref).toHaveLength(8);
    expect(ref).toMatch(/^[A-Z0-9]{8}$/);
    // 它是**短号**,不是那个 id:整串 id 绝不上商家的屏幕。
    expect(cardId).not.toBe(ref);
    expect(diagnosticRef(null)).toBeNull();
  });

  it("CREATE-A1 服务端动作抛了:商家读到单一措辞源那一句 + 那张卡自己的短号", async () => {
    // 走查按下 `Generate · 1 credit` 两次,两次都落进这一支 —— 从前它是一个写死的
    // `Couldn't start that — please try again.`,商家、日志、走查报告三方没有共同的把手。
    const cardId = `msg_${randomUUID()}`;
    mockCoworkGenerate.mockRejectedValueOnce(new Error("boom: something server-side"));

    const outcome = await runPlanApproval({
      threadId: `thr_${randomUUID()}`,
      cardId,
      pendingApproval: false, // 刚被提议的卡 —— 走 `coworkGenerate` 那条路
      payload: { kind: "image", model: "seedream-4-0", credits: 1 } as never,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    // 句子:单一措辞源那一份,一字不改。
    expect(outcome.error).toBe(GENERATION_START_FAILED);
    // 短号:与服务端日志里那一行同一个函数、同一串,而且真的到得了卡面。
    expect(outcome.ref).toBe(diagnosticRef(cardId));
    expect(outcome.ref).toMatch(/^[A-Z0-9]{8}$/);
    // 抛出来的原文一个字都不上商家的屏幕。
    expect(outcome.error).not.toContain("boom");
  });

  it("CREATE-A2 服务端已经说清楚了:泛化句盖不掉那句具体的拒绝,短号照旧给", async () => {
    const cardId = `msg_${randomUUID()}`;
    const spoken = referenceUnavailableMessage("videoAsImage");
    mockCoworkGenerate.mockResolvedValueOnce({ error: spoken });

    const outcome = await runPlanApproval({
      threadId: `thr_${randomUUID()}`,
      cardId,
      pendingApproval: false, // 刚被提议的卡 —— 走 `coworkGenerate` 那条路
      payload: { kind: "image", model: "seedream-4-0", credits: 1 } as never,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toBe(spoken);
    expect(outcome.error).not.toBe(GENERATION_START_FAILED);
    expect(outcome.ref).toBe(diagnosticRef(cardId));
  });
});
