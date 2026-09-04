/**
 * creation-cross-canvas-reference —— 跨画布引用的全真证据(Codex 只读 E2E QA-CRE-FE9-013)。
 *
 * 规格 `docs/specs/creation-engine.md`,验收 **CREATE-A2**(素材指派:图＝产品参考;
 * 「花钱前诚实拒绝并说明原因、ledger 零新增行」)与 **CREATE-A1**(花钱前看得见)。
 *
 * ── Codex 那一轮发生了什么 ────────────────────────────────────────────────
 * 商家在画布 B 用「Choose from Library」选了画布 A 生成的蓝杯子,composer 上出现
 * `Image ref`,发送后 Otto 说没看到杯子;两条 USER 消息的 DB payload 都是
 * `sourceGenerationIds: []`,GEN_CARD 与 GenJob 也没有杯子的 id。病根是同一条规矩被抄成
 * 六份 where、六份都多写了一格 `projectId`,而选单读的是**全店**历史。
 *
 * ── 这一份钉住什么 ────────────────────────────────────────────────────────
 *   · CREATE-A2:甲店画布 A 的 generation 在甲店画布 B 被引用 ⇒ 解析器解得出来,回执带出处,
 *     卡上冻着同一个 id,GenJob 也是同一个 id(一路同一条身份,没有第二个);
 *   · CREATE-A2:乙店的 generation id 被甲店引用 ⇒ 可见拒绝、零 GenJob、**ledger 零新增行**;
 *   · CREATE-A2:已软删 / 存储对象缺失 ⇒ 同样是可见拒绝,而不是静默丢掉;
 *   · CREATE-A1:回执里那一行商家读得懂的名字与来源画布,是**服务端**产的,不是卡面猜的。
 *
 * 真 Postgres(*_test)、真 Prisma、真本地存储、真 credit ledger(经真 `startCoworkGen`)。
 * 零 provider 调用、零花费。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildGenRequestFromCard, referenceUnavailableMessage } from "@fikirtive/core";
import { buildProposeCard, type CardPayload, type OttoContext } from "@fikirtive/otto";

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

const { validateOttoTurnReferences, unavailableReferenceMessage } = await import("../otto-actions");
const { startCoworkGen } = await import("../gen-actions");
const { storage } = await import("../storage");
const { prisma } = await import("@fikirtive/db");

const INTERNAL_PER_DISPLAY_BALANCE = 500_000;
const CUP_PROMPT = "A blue ceramic cup on a linen cloth";

type Shop = { ownerId: string; canvasA: string; canvasB: string; threadId: string };

async function seedShop(canvasAName: string, canvasBName: string): Promise<Shop> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance: INTERNAL_PER_DISPLAY_BALANCE, reserved: 0 } });
  const canvasA = `prj_${randomUUID()}`;
  const canvasB = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: canvasA, ownerId, name: canvasAName } });
  await prisma.project.create({ data: { id: canvasB, ownerId, name: canvasBName } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId: canvasB, title: "Otto" } });
  return { ownerId, canvasA, canvasB, threadId };
}

/** 一张真的、字节真的落在本地存储里的生成图。 */
async function seedImageGeneration(
  ownerId: string,
  projectId: string,
  prompt: string,
): Promise<{ generationId: string; key: string }> {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...randomUUID().split("").map((c) => c.charCodeAt(0))]);
  const { contentHash, key } = await storage.put(ownerId, bytes, "png");
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: { id: assetId, ownerId, contentHash, ext: "png", mime: "image/png", sizeBytes: BigInt(bytes.length), source: "GENERATED" },
  });
  const generationId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: { id: generationId, ownerId, projectId, shotId: null, assetId, source: "GENERATED", promptText: prompt, entitySnapshot: { entities: [] } },
  });
  return { generationId, key };
}

function ottoCtx(over: Partial<OttoContext> & { orgId: string; projectId: string; threadId: string }): OttoContext {
  return { userId: "user-test", disabledModels: [], sourceGenerationId: null, ...over } as OttoContext;
}

/** Otto 铸的那张确认卡,原样落库(与 `otto-resolution-tier-ledger` 同一套替身)。 */
async function mintImageCard(shop: Shop, ctxOver: Partial<OttoContext>): Promise<{ cardId: string; payload: CardPayload }> {
  const { cardPayload } = buildProposeCard(
    { kind: "image", structuredPrompt: "Put my cup on a marble counter", entityIds: [], variantSel: {}, count: 1 },
    ottoCtx({ orgId: shop.ownerId, projectId: shop.canvasB, threadId: shop.threadId, ...ctxOver }),
    [],
  );
  const cardId = `msg_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: { id: cardId, threadId: shop.threadId, ownerId: shop.ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1, text: "", payload: cardPayload as unknown as object },
  });
  return { cardId, payload: cardPayload };
}

async function ledgerRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CREATE-A2 跨画布的 Library 参考:同一租户任意画布都用得上", () => {
  it("CREATE-A2 甲店画布 A 的图在画布 B 被引用:解析器解得出、回执带出处、卡与 GenJob 是同一个 id", async () => {
    const shop = await seedShop("Product shots", "Raya campaign");
    mockRequireOwner.mockResolvedValue({ ownerId: shop.ownerId, email: `${shop.ownerId}@fikirtive.test` });
    const cup = await seedImageGeneration(shop.ownerId, shop.canvasA, CUP_PROMPT);

    // ① 解析:当前这一轮在画布 B,引用的是画布 A 做出来的那张图。
    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [cup.generationId],
    });
    expect(refs.unavailable).toEqual([]);
    expect(refs.sourceGenerationIds).toEqual([cup.generationId]);

    // ② 回执:商家读得懂的名字 + 来源画布,由服务端产出(卡面不猜)。
    expect(refs.mediaReferences).toHaveLength(1);
    const receipt = refs.mediaReferences[0]!;
    expect(receipt.generationId).toBe(cup.generationId);
    expect(receipt.kind).toBe("image");
    expect(receipt.label).toBe(CUP_PROMPT);
    expect(receipt.sourceProjectId).toBe(shop.canvasA);
    expect(receipt.sourceProjectName).toBe("Product shots");
    expect(receipt.sameCanvas).toBe(false);
    expect(receipt.previewUrl).toBe(`/files/${cup.key}`);

    // ③ 铸卡:卡上冻的就是这一个 id,而且带着它的回执(缺回执的卡前端不给 Generate)。
    const card = await mintImageCard(shop, {
      sourceGenerationId: refs.sourceGenerationIds[0],
      sourceGenerationIds: refs.sourceGenerationIds,
      mediaReferences: refs.mediaReferences,
    });
    expect(card.payload.sourceGenerationId).toBe(cup.generationId);
    expect(card.payload.mediaReferences?.map((r) => r.generationId)).toEqual([cup.generationId]);
    expect(card.payload.mediaReferences?.[0]?.sourceProjectName).toBe("Product shots");

    // ④ 批准:GenJob 冻的还是同一个 id —— 一路一条身份,没有第二个。
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
      select: { sourceGenerationId: true, projectId: true },
    });
    expect(job.sourceGenerationId).toBe(cup.generationId);
    // 这一单跑在画布 B 上,而参考来自画布 A —— 画布是出处,不是权限边界。
    expect(job.projectId).toBe(shop.canvasB);
  });

  it("CREATE-A2 同一块画布上的引用照旧可用,回执不再多说一句出处", async () => {
    const shop = await seedShop("Product shots", "Raya campaign");
    const local = await seedImageGeneration(shop.ownerId, shop.canvasB, CUP_PROMPT);

    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [local.generationId],
    });

    expect(refs.unavailable).toEqual([]);
    expect(refs.mediaReferences[0]!.sameCanvas).toBe(true);
  });
});

describe("CREATE-A2 取不到的引用:可见拒绝,不是静默丢掉", () => {
  it("CREATE-A2 乙店的 generation id 被甲店引用:可见拒绝、零 GenJob、ledger 零新增行", async () => {
    const shopA = await seedShop("Product shots", "Raya campaign");
    const shopB = await seedShop("Other shop A", "Other shop B");
    mockRequireOwner.mockResolvedValue({ ownerId: shopA.ownerId, email: `${shopA.ownerId}@fikirtive.test` });
    const theirs = await seedImageGeneration(shopB.ownerId, shopB.canvasA, "someone else's jar");

    const refs = await validateOttoTurnReferences({
      ownerId: shopA.ownerId,
      projectId: shopA.canvasB,
      sourceGenerationIds: [theirs.generationId],
    });

    // 拒绝,而且拒绝是**看得见的**:上一版这里是一个空数组,发送照常继续。
    expect(refs.sourceGenerationIds).toEqual([]);
    expect(refs.mediaReferences).toEqual([]);
    expect(refs.unavailable).toEqual([{ id: theirs.generationId, reason: "notFound" }]);
    expect(unavailableReferenceMessage(refs.unavailable)).toBe(referenceUnavailableMessage("notFound"));
    // 措辞里不许出现「别人的」这种把别家账号存在与否说出来的话。
    expect(unavailableReferenceMessage(refs.unavailable)).not.toMatch(/another|someone|other account/i);

    // 一轮被拒绝的发送不产生任何后果。
    expect(await prisma.genJob.count({ where: { ownerId: shopA.ownerId } })).toBe(0);
    expect(await ledgerRows(shopA.ownerId)).toEqual([]);
    expect(await prisma.chatMessage.count({ where: { ownerId: shopA.ownerId } })).toBe(0);
  });

  it("CREATE-A2 已软删的引用:可见拒绝、零 GenJob、ledger 零新增行", async () => {
    const shop = await seedShop("Product shots", "Raya campaign");
    const cup = await seedImageGeneration(shop.ownerId, shop.canvasA, CUP_PROMPT);
    await prisma.generation.updateMany({ where: { id: cup.generationId, ownerId: shop.ownerId }, data: { deletedAt: new Date() } });

    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [cup.generationId],
    });

    expect(refs.unavailable).toEqual([{ id: cup.generationId, reason: "notFound" }]);
    expect(refs.sourceGenerationIds).toEqual([]);
    expect(await prisma.genJob.count({ where: { ownerId: shop.ownerId } })).toBe(0);
    expect(await ledgerRows(shop.ownerId)).toEqual([]);
  });

  it("CREATE-A2 行还在但存储对象没了:可见拒绝(reason 分得开),ledger 零新增行", async () => {
    const shop = await seedShop("Product shots", "Raya campaign");
    const cup = await seedImageGeneration(shop.ownerId, shop.canvasA, CUP_PROMPT);
    await storage.deleteObject(cup.key);

    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [cup.generationId],
    });

    expect(refs.unavailable).toEqual([{ id: cup.generationId, reason: "fileMissing" }]);
    expect(unavailableReferenceMessage(refs.unavailable)).toBe(referenceUnavailableMessage("fileMissing"));
    expect(refs.sourceGenerationIds).toEqual([]);
    expect(await ledgerRows(shop.ownerId)).toEqual([]);
  });

  it("CREATE-A2 一轮里有好有坏:整轮拒绝,不许「把好的送出去、坏的悄悄丢掉」", async () => {
    const shop = await seedShop("Product shots", "Raya campaign");
    const good = await seedImageGeneration(shop.ownerId, shop.canvasA, CUP_PROMPT);
    const gone = await seedImageGeneration(shop.ownerId, shop.canvasA, "a jar that got deleted");
    await prisma.generation.updateMany({ where: { id: gone.generationId, ownerId: shop.ownerId }, data: { deletedAt: new Date() } });

    const refs = await validateOttoTurnReferences({
      ownerId: shop.ownerId,
      projectId: shop.canvasB,
      sourceGenerationIds: [good.generationId, gone.generationId],
    });

    // 好的那一件仍然解得出来(回执要能告诉商家哪一件出了事),但 `unavailable` 非空 ⇒
    // 两个发送入口都在这一步整轮拒绝,一条 USER 消息都不落库。
    expect(refs.sourceGenerationIds).toEqual([good.generationId]);
    expect(refs.unavailable).toEqual([{ id: gone.generationId, reason: "notFound" }]);
  });
});
