/**
 * FSE-210 / PRODID-R11 —— `@` 选入的产品进生成谱系(规格 `docs/specs/brand-product-identity.md`
 * §5 PRODID-R11,票 #1391;2026-09-12 S5 批量裁决升 P1;PR #1420 判官 P1-1/P1-2 修复轮)。
 *
 * 走查根因(`docs/audits/fullstack-staging-2026-09-11/backend-evidence.md` §4.5):同一张画布上,
 * `@` 产品与 `@` 演员待遇不一样 —— 产品那一轮 USER 消息 `payload.entityIds` 有产品 Entity id,
 * 但确认卡 `entityIds=[]`、`GenJob.entityIds={}`、`approvedEntities=NULL`;演员那一轮三格齐全。
 *
 * 判官证死的病灶(P1-1,不是「typed ref 交接丢了」这么简单):模型知道 Entity id 的唯一通道是
 * `availableRefs`(`otto-actions.ts` 的 `loadAvailableRefsForAgent`),它按
 * `referenceImages: { some: { deletedAt: null } }` **过滤掉了没有参考图的元素**。商家 `@` 一件
 * 还没挂图的产品之后,这件产品的名字压根没出现在模型看得到的候选名单里 —— 模型没有任何一条路
 * 能把它的 id 写进 `propose` 工具的 `entityIds` 参数,`buildProposeCard` 于是只信模型那份空
 * 参数,铸出一张 `entityIds=[]` 的卡。首页 composer 丢 `referenceRefs` 只是**同一条链**上更早
 * 一步的现象(已在上一轮修过),不是这条病灶本身;本轮修的是铸卡这一步的服务端兜底。
 *
 * 修法(`packages/otto/src/context.ts` 的 `OttoContext.turnEntityIds` +
 * `packages/otto/src/skills/propose.helpers.ts` 的 `buildProposeCard`):铸卡时把**这一轮服务端
 * 已经核过归属的 entity id**(`resolveOwnedReferenceRefs` 算出来的那份,不看模型填没填)并进
 * 模型自带的 `entityIds`,并集去重。`apps/web/lib/otto-actions.ts` 的 `buildOttoContext` 与
 * `app/api/otto/stream/route.ts` 把这份并集原样喂进 `ctx.turnEntityIds`;
 * `packages/otto/src/skills/propose.ts` 的 `ownedEntities` 查询集同步跟上(否则并进来的 id
 * 会在归属闸上被判「查无此人」)。
 *
 * 判官 P1-2(测试别短路):这份文件从前直接手写字面量 `approvedEntities` 落一张 GEN_CARD,
 * 什么都证不了 —— 铸卡这一步(`buildProposeCard`)从没被真的跑过。现在两条提交路都造一件
 * **没有参考图**的产品(判官用的反例夹具,也是 `availableRefs` 会漏掉的那一种),用真实
 * `buildProposeCard`(不 mock)铸卡,模拟模型自己的 `entityIds` 参数是空的(它的候选名单里
 * 本来就没有这件产品)——`ctx.turnEntityIds` 必须独自把它救回来。
 *
 * 硬口径:真数据库、真 Prisma。只有 `requireOwner`(固定 ownerId,`gen-ledger.test.ts` 同一
 * 手法)、队列与型号注册表被替身 —— 花钱链路本身、两条路各自的消息构造(`canvas-entry-
 * actions` 的交接回执 / `reference-refs` 的 `@` 解析)、以及铸卡(`buildProposeCard`)全部真跑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildProposeCard, type CardPayload, type OttoContext } from "@fikirtive/otto";
import { buildGenRequestFromCard, formatReferenceRef, type ApprovedEntity } from "@fikirtive/core";

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
// 花钱链路本身不是这份文件要证的东西(那是 gen-ledger.test.ts 的活)—— 放行,同
// `gen-ledger.test.ts` 非 MONEY-A6 用例的默认口径。真正要证的是 Entity 归属那道闸
// (`gen-actions.ts` 自己的 `approvedEntityDrift`,不在这个 mock 覆盖范围内,照旧真跑)。
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));

const { startCoworkGen } = await import("../gen-actions");
const { createCanvasConversation, getCanvasConversationHandoff } = await import("../canvas-entry-actions");
const { resolveOwnedReferenceRefs } = await import("../reference-refs");
const { prisma, createProduct } = await import("@fikirtive/db");

function asOwner(ownerId: string): void {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}

/** 真 org + 真账本(`gen-ledger.test.ts` 同一手法)——花钱链路本身不是这份文件要证的东西,
 *  这里只要求它能走得通,余额给够即可。 */
async function seedOrg(): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance: 1000, reserved: 0 } });
  return ownerId;
}

async function seedProject(ownerId: string, name: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name } });
  return id;
}

/**
 * 一件真产品、**没有参考图**(`createProduct` 不带 `assetIds`)—— 判官用来证死病灶的反例夹具:
 * `loadAvailableRefsForAgent`(`otto-actions.ts`)只把 `referenceImages: { some: { deletedAt: null } }`
 * 的元素放进模型的 `@` 候选名单,这件产品从一开始就不在模型能看见的名单里。
 */
async function seedProductWithoutImage(ownerId: string, name: string): Promise<string> {
  const outcome = await createProduct({ ownerId, data: { name }, source: "user" });
  if (!outcome.created || !outcome.entityId) throw new Error("createProduct 没有建出身份");
  return outcome.entityId;
}

/**
 * 铸一张真的 propose 确认卡 —— 与生产同一条路(`packages/otto/src/skills/propose.ts` 的
 * `executePropose`,`buildProposeCard` 是它的纯核心;这里手动做它前后各一步的 DB 读写,因为
 * `executePropose` 没有从 `@fikirtive/otto` 的包顶层导出)。
 *
 * `modelEntityIds` 模拟**模型自己**在 propose 工具参数里填的 `entityIds`——这条测试始终传
 * `[]`,因为这正是反例夹具的处境:产品不在模型的 `@` 候选名单里,模型没有任何一条路知道它的
 * id。`ctx.turnEntityIds` 必须独自把它救回来,这正是 P1-1 要证的那句话。
 */
async function mintProposeCard(args: {
  ownerId: string;
  projectId: string;
  threadId: string;
  turnEntityIds: string[];
  structuredPrompt: string;
}): Promise<{ cardId: string; payload: CardPayload }> {
  const modelEntityIds: string[] = [];
  // 与 `propose.ts` 的 `executePropose` 同一条查询集:模型自带的那份并上这一轮服务端已核过
  // 归属的 `turnEntityIds`(P1-1 的另一半 —— 查询集必须跟得上 `buildProposeCard` 内部并的
  // 那份,否则归属闸会把并集救回来的 id 误判成「查无此人」)。
  const wantedEntityIds = [...new Set([...modelEntityIds, ...args.turnEntityIds])];
  const ownedEntities: ApprovedEntity[] = wantedEntityIds.length
    ? await prisma.entity.findMany({
        where: { id: { in: wantedEntityIds }, ownerId: args.ownerId, deletedAt: null },
        select: { id: true, type: true, name: true },
      })
    : [];
  const ctx = {
    orgId: args.ownerId,
    userId: args.ownerId,
    projectId: args.projectId,
    threadId: args.threadId,
    disabledModels: [],
    sourceGenerationId: null,
    // P1-1 的核心:这一轮服务端已核过归属的 entity id,模型自己没带上。
    turnEntityIds: args.turnEntityIds,
  } as OttoContext;
  const { cardPayload } = buildProposeCard(
    { kind: "image", structuredPrompt: args.structuredPrompt, entityIds: modelEntityIds, variantSel: {}, count: 1 },
    ctx,
    ownedEntities,
  );
  const cardId = `msg_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: {
      id: cardId, threadId: args.threadId, ownerId: args.ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1, text: "",
      payload: cardPayload as unknown as object,
    },
  });
  return { cardId, payload: cardPayload };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FSE-210 / PRODID-R11 — @ 选入的、没有参考图的产品进生成谱系", () => {
  it("FSE-210: 首页 composer → canvas.create-handoff → 真实 buildProposeCard → GenJob.entityIds 与 approvedEntities 指到同一个 Entity id", async () => {
    const ownerId = await seedOrg();
    asOwner(ownerId);
    const productName = `Kopi tumbler ${randomUUID().slice(0, 8)}`;
    const productEntityId = await seedProductWithoutImage(ownerId, productName);

    // ① 首页 composer 送出:@ 到这件(没有参考图的)产品,typed ref 落进 handoff 的回执。
    const created = await createCanvasConversation({
      prompt: `Feature the ${productName} on a beach`,
      requestId: randomUUID(),
      references: [{ type: "product", id: productEntityId }],
    });
    if ("error" in created) throw new Error(`createCanvasConversation 失败:${created.error}`);

    // ② 画布首轮读回这条 handoff —— 归属已核过的这一轮 entity id。
    const handoff = await getCanvasConversationHandoff({
      ownerId, handoffId: created.handoffId, projectId: created.projectId, threadId: created.threadId,
    });
    if (!handoff) throw new Error("getCanvasConversationHandoff 没有读回这条 handoff");
    expect(handoff.entityIds).toEqual([productEntityId]);
    expect(handoff.references).toEqual([formatReferenceRef({ type: "product", id: productEntityId })]);

    // ③ 铸卡:真实 buildProposeCard(不 mock),模型自己的 entityIds 是空的(这件产品没有
    //    参考图,从没出现在模型的 @ 候选名单里)—— ctx.turnEntityIds 必须独自把它救回来。
    const card = await mintProposeCard({
      ownerId, projectId: created.projectId, threadId: created.threadId,
      turnEntityIds: handoff.entityIds,
      structuredPrompt: `Feature the ${productName} on a beach`,
    });
    // 这一句是判官 P1-1 证死的病灶本身:修复前这张卡的 entityIds 是 []、approvedEntities 缺席。
    expect(card.payload.entityIds).toEqual([productEntityId]);
    expect(card.payload.approvedEntities).toEqual([{ id: productEntityId, type: "PRODUCT", name: productName }]);

    // ④ 批准:与生产同一条路(`buildGenRequestFromCard` + `startCoworkGen`),只信卡上冻的那份。
    const built = buildGenRequestFromCard({
      cardPayload: card.payload, projectId: created.projectId, threadId: created.threadId, cardId: card.cardId,
      entityIds: card.payload.entityIds, variantSel: card.payload.variantSel,
    });
    if (!built.ok) throw new Error(`buildGenRequestFromCard 失败:${built.error}`);
    const res = await startCoworkGen(built.req);
    if ("error" in res) throw new Error(`startCoworkGen 拒绝了这件产品:${res.error}`);

    // ⑤ 验收 PRODID-R11 / FSE-210:GenJob.entityIds 与 approvedEntities 指到**同一个** Entity id。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: res.id, ownerId },
      select: { entityIds: true, approvedEntities: true },
    });
    expect(job.entityIds).toEqual([productEntityId]);
    expect(job.approvedEntities).toEqual([{ id: productEntityId, type: "PRODUCT", name: productName }]);
  }, 60_000);

  it("FSE-210: 画布内直接 @ 提交 → 真实 buildProposeCard → GenJob.entityIds 与 approvedEntities 指到同一个 Entity id", async () => {
    const ownerId = await seedOrg();
    asOwner(ownerId);
    const projectId = await seedProject(ownerId, "FSE-210 canvas submit");
    const productName = `Nasi lemak set ${randomUUID().slice(0, 8)}`;
    const productEntityId = await seedProductWithoutImage(ownerId, productName);

    // ① 画布 composer 的 @ 菜单选中这件(没有参考图的)产品:与 useReferencePicker 同一条
    //    wire 形式,按当前 owner 服务端解析(与直接敲字送出那一发同一个函数)。
    const wire = formatReferenceRef({ type: "product", id: productEntityId });
    const resolved = await resolveOwnedReferenceRefs(ownerId, [wire]);
    expect(resolved.entityIds).toEqual([productEntityId]);
    expect(resolved.unresolved).toBe(0);

    const threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });

    // ② 铸卡:真实 buildProposeCard,模型自己的 entityIds 同样是空的。
    const card = await mintProposeCard({
      ownerId, projectId, threadId,
      turnEntityIds: resolved.entityIds,
      structuredPrompt: `Feature the ${productName} on a table`,
    });
    expect(card.payload.entityIds).toEqual([productEntityId]);
    expect(card.payload.approvedEntities).toEqual([{ id: productEntityId, type: "PRODUCT", name: productName }]);

    // ③ 批准。
    const built = buildGenRequestFromCard({
      cardPayload: card.payload, projectId, threadId, cardId: card.cardId,
      entityIds: card.payload.entityIds, variantSel: card.payload.variantSel,
    });
    if (!built.ok) throw new Error(`buildGenRequestFromCard 失败:${built.error}`);
    const res = await startCoworkGen(built.req);
    if ("error" in res) throw new Error(`startCoworkGen 拒绝了这件产品:${res.error}`);

    // ④ 验收 PRODID-R11 / FSE-210:与首页 composer 那条路读出的是同一份形状
    //    (对称验证:两条提交路不是两套真相)。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: res.id, ownerId },
      select: { entityIds: true, approvedEntities: true },
    });
    expect(job.entityIds).toEqual([productEntityId]);
    expect(job.approvedEntities).toEqual([{ id: productEntityId, type: "PRODUCT", name: productName }]);
  }, 60_000);
});
