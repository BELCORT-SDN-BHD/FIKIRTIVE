/**
 * FSE-210 / PRODID-R11 —— `@` 选入的产品进生成谱系(规格 `docs/specs/brand-product-identity.md`
 * §5 PRODID-R11,票 #1391;2026-09-12 S5 批量裁决升 P1)。
 *
 * 走查根因(`docs/audits/fullstack-staging-2026-09-11/backend-evidence.md` §4.5):同一张画布上,
 * `@` 产品与 `@` 演员待遇不一样 —— 产品那一轮 USER 消息 `payload.entityIds` 有产品 Entity id,
 * 但确认卡 `entityIds=[]`、`GenJob.entityIds={}`、`approvedEntities=NULL`;演员那一轮三格齐全。
 * 另一处同族现象:走**首页 composer**(`canvas.create-handoff`)进来的那一轮,`referenceRefs`
 * 是空的,而直接在画布里敲的那几轮都有 —— 交接那条路把 typed ref 丢了。
 *
 * 修法(判官注记,"勿漏"):产品与演员走**同一条** typed ref 搬运路,`canvas.create-handoff`
 * 保住 `referenceRefs`(`apps/web/lib/canvas-entry-actions.ts` 的 `CanvasConversationHandoff.
 * references` + `apps/web/components/canvas/ImmersiveCanvasEntry.tsx` 的 `pendingFirst.
 * references`)。
 *
 * 复测口径(票面):`@` 一件产品出一次片后,`GenJob.entityIds` 与 `approvedEntities` 指到
 * **同一个** Entity id;首页 composer 与画布内两条提交路各验一次。
 *
 * 硬口径:真数据库、真 Prisma。只有 `requireOwner`(固定 ownerId,`gen-ledger.test.ts` 同一
 * 手法)、队列与型号注册表被替身 —— 花钱链路本身、以及两条路各自的消息构造(`canvas-entry-
 * actions` 的交接回执 / `reference-refs` 的 `@` 解析)全部真跑。
 *
 * `startCoworkGen` 那一步刻意**不**跑真的 Otto 智能体(离线环境跑不了真 LLM 调用)——
 * 它直接落一张 GEN_CARD,`entityIds`/`approvedEntities` 就是 Otto 本该按两条路各自交出来的
 * 那份产品 Entity id(与 `actor-library-seed.test.ts` 的 CREATE-A10、`gen-ledger.test.ts` 的
 * MONEY-A6 同一手法:审批身份只有卡片入口这一条合法来源,直接调 `startGen` 带自制快照会被
 * 出界闸拒掉)。两条测试各自证的是**消息构造那一半**(判官根因指名的那一步:「消息 → 确认卡」
 * 之前,typed ref 有没有在交接/解析这一步就丢了),接上同一段(已经真跑过)的卡→审批→GenJob
 * 链路,读出同一个 id。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
const { formatReferenceRef, pricedGenCredits, displayCredits } = await import("@fikirtive/core");

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

/** 一件真产品 —— 身份(`Entity(PRODUCT)`)与价签同事务出生,唯一写路(`createProduct`)。 */
async function seedProduct(ownerId: string, name: string): Promise<string> {
  const outcome = await createProduct({ ownerId, data: { name }, source: "user" });
  if (!outcome.created || !outcome.entityId) throw new Error("createProduct 没有建出身份");
  return outcome.entityId;
}

/**
 * 一张真的 GEN_CARD —— 商家批准时服务端持久化下来的那张卡,落在**已有**的 threadId 下。
 * `startCoworkGen` 只认这一份(`cowork:<cardId>`),`entityIds`/`approvedEntities` 就是
 * Otto 铸卡那一刻本该从这条消息的 typed ref 里读出来、交出来的那份产品身份。
 */
async function seedGenCardMessage(input: {
  ownerId: string;
  threadId: string;
  approvedEntities: { id: string; type: string; name: string }[];
}): Promise<string> {
  const cardId = `msg_${randomUUID()}`;
  const quote = pricedGenCredits({
    kind: "IMAGE", model: "seedream", count: 1, referenceVideoGenerationId: null, videoOptions: null,
  });
  await prisma.chatMessage.create({
    data: {
      id: cardId, threadId: input.threadId, ownerId: input.ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1, text: "",
      payload: {
        kind: "image", model: "seedream",
        estimatedCredits: displayCredits(quote),
        entityIds: input.approvedEntities.map((e) => e.id),
        approvedEntities: input.approvedEntities,
      },
    },
  });
  return cardId;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FSE-210 / PRODID-R11 — @ 选入的产品进生成谱系", () => {
  it("FSE-210: 首页 composer → canvas.create-handoff → GenJob.entityIds 与 approvedEntities 指到同一个 Entity id", async () => {
    const ownerId = await seedOrg();
    asOwner(ownerId);
    const productName = `Kopi tumbler ${randomUUID().slice(0, 8)}`;
    const productEntityId = await seedProduct(ownerId, productName);

    // ① 首页 composer 送出:@ 到这件产品,typed ref 落进 canvas.create-handoff 的回执。
    const created = await createCanvasConversation({
      prompt: `Feature the ${productName} on a beach`,
      requestId: randomUUID(),
      references: [{ type: "product", id: productEntityId }],
    });
    if ("error" in created) throw new Error(`createCanvasConversation 失败:${created.error}`);

    // ② 画布首轮读回这条 handoff —— 判官注记要保住的那一段:交接这一步不许把 typed ref 丢了。
    const handoff = await getCanvasConversationHandoff({
      ownerId, handoffId: created.handoffId, projectId: created.projectId, threadId: created.threadId,
    });
    if (!handoff) throw new Error("getCanvasConversationHandoff 没有读回这条 handoff");
    expect(handoff.entityIds).toEqual([productEntityId]);
    // referenceRefs 那一半(FSE-210 判官注记的核心):不是只有裸 entityIds,typed wire 引用
    // 也必须原样交接过去,否则这一轮的 ChatMessage.referenceRefs 是空的。
    expect(handoff.references).toEqual([formatReferenceRef({ type: "product", id: productEntityId })]);

    // ③ Otto 按 handoff 交出来的这份 entityIds 铸卡(与直接在画布里 @ 同一份 approvedEntities
    //    冻结纪律 —— packages/otto/src/skills/propose.helpers.ts 的 Step 4.8),商家按 Generate。
    const approvedEntities = [{ id: productEntityId, type: "PRODUCT", name: productName }];
    const cardId = await seedGenCardMessage({ ownerId, threadId: created.threadId, approvedEntities });
    const res = await startCoworkGen({
      projectId: created.projectId, threadId: created.threadId,
      prompt: `Feature the ${productName} on a beach`, count: 1, kind: "image", model: "seedream",
      entityIds: [productEntityId],
      idempotencyKey: `cowork:${cardId}`,
    });
    if ("error" in res) throw new Error(`startCoworkGen 拒绝了这件产品:${res.error}`);

    // ④ 验收 PRODID-R11 / FSE-210:GenJob.entityIds 与 approvedEntities 指到**同一个** Entity id。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: res.id, ownerId },
      select: { entityIds: true, approvedEntities: true },
    });
    expect(job.entityIds).toEqual([productEntityId]);
    expect(job.approvedEntities).toEqual(approvedEntities);
  }, 60_000);

  it("FSE-210: 画布内直接 @ 提交 → GenJob.entityIds 与 approvedEntities 指到同一个 Entity id", async () => {
    const ownerId = await seedOrg();
    asOwner(ownerId);
    const projectId = await seedProject(ownerId, "FSE-210 canvas submit");
    const productName = `Nasi lemak set ${randomUUID().slice(0, 8)}`;
    const productEntityId = await seedProduct(ownerId, productName);

    // ① 画布 composer 的 @ 菜单选中这件产品:与 useReferencePicker.referencesForSend 同一条
    //    wire 形式,按当前 owner 服务端解析(与直接敲字送出那一发同一个函数)。
    const wire = formatReferenceRef({ type: "product", id: productEntityId });
    const resolved = await resolveOwnedReferenceRefs(ownerId, [wire]);
    expect(resolved.entityIds).toEqual([productEntityId]);
    expect(resolved.unresolved).toBe(0);
    expect(resolved.wire).toEqual([wire]);

    // ② Otto 按这份 entityIds 铸卡,商家按 Generate。
    const threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
    const approvedEntities = [{ id: productEntityId, type: "PRODUCT", name: productName }];
    const cardId = await seedGenCardMessage({ ownerId, threadId, approvedEntities });
    const res = await startCoworkGen({
      projectId, threadId,
      prompt: `Feature the ${productName} on a table`, count: 1, kind: "image", model: "seedream",
      entityIds: resolved.entityIds,
      idempotencyKey: `cowork:${cardId}`,
    });
    if ("error" in res) throw new Error(`startCoworkGen 拒绝了这件产品:${res.error}`);

    // ③ 验收 PRODID-R11 / FSE-210:GenJob.entityIds 与 approvedEntities 指到**同一个** Entity id
    //    —— 与首页 composer 那条路读出的是同一份形状(对称验证:两条路不是两套真相)。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: res.id, ownerId },
      select: { entityIds: true, approvedEntities: true },
    });
    expect(job.entityIds).toEqual([productEntityId]);
    expect(job.approvedEntities).toEqual(approvedEntities);
  }, 60_000);
});
