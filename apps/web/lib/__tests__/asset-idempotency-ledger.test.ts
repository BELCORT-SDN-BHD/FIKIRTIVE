/**
 * asset-idempotency-ledger —— 资产详情面板 / 模板弹窗那一族付费动作的**双扣证据**,
 * 跑在真 Postgres(*_test)、真 Prisma、真积分台账上。
 *
 * 补的是哪个洞:这三个按钮(Regenerate / Animate / Generate edit,加上模板弹窗的
 * Generate)过去在**浏览器里**出幂等键,而且键里带 `Date.now()` / 每次新开弹窗一个新
 * uuid。带时间戳的键 = 同一个意图的两次提交拿到两个不同身份,于是:
 *
 *   · 服务端的「活跃键复用」查不到那是重放;
 *   · 数据库的 `GenJob_active_idempotency_key` 唯一索引也拦不住(两个键本来就不冲突);
 *   · 唯一挡着的是面板自己的一个 React ref —— 刷新一次它就没了,第二个标签页里它根本
 *     不存在,断线重连后的那一次重发同样绕过它。
 *
 * 结果是同一件东西预扣两次。这个文件之前**一个字都没有钉住这件事**(判定见钱路审计
 * money-audit P1)。下面每一条都用真台账数数:一次意图 = 一单 = 一行 RESERVE。
 *
 * 只有 web 层的周边是假件(auth guard、impersonation、队列、guardian、机型开关、
 * next/cache)—— 与 gen-ledger.test.ts / factory-batch-ledger.test.ts 同一套。零 provider
 * 调用,零真实花费。worker 的成功终态用它自己调的那个函数模拟(settleCredits);这个文件
 * 不碰失败终态,所以没有 refundReservation —— 别照着 gen-ledger.test.ts 的措辞读成两个。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, activeImageModel } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { startAssetGen, getActiveGenModels } = await import("../gen-actions");
const { prisma, settleCredits } = await import("@fikirtive/db");
const { assetActionKey } = await import("../batch-idempotency");

const IMG = INTERNAL_PER_DISPLAY; // 一张图 = 1 显示 credit = 10 内部
const VIDEO_5S_720P = 11 * INTERNAL_PER_DISPLAY; // seedance-2-mini 720p/5s(#644 裁决)

/**
 * 夹具的 `model` 与产线**同源**(#1032)。
 *
 * 真实的四个付费入口一个都不写引擎名:TemplateModal.tsx:264 与 DetailPanel.tsx:339 / 397 /
 * 485 送的都是 `getActiveGenModels()` 回的公开别名(`capability-<kind>-N`),引擎名从来不
 * 出浏览器。夹具过去直接送 `"seedream"` / `"seedance-2-mini"` —— 于是这个文件跑的输入形状
 * 与产线不是同一个,而幂等键恰恰是从这个形状算出来的。这里改成向同一个函数要,连别名的
 * 拼法都不在测试里另抄一份。
 */
const ACTIVE = await getActiveGenModels();
const IMAGE_ALIAS = ACTIVE.image; // "capability-image-1"
const VIDEO_ALIAS = ACTIVE.video; // "capability-video-1"

// ── real-DB helpers(gen-ledger / factory-batch-ledger 同一套) ───────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Asset idempotency test" } });
  return id;
}
async function reserveRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId, kind: "RESERVE" }, orderBy: { createdAt: "asc" } });
}
async function jobs(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({
    where: { ownerId, projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, kind: true, idempotencyKey: true, prompt: true },
  });
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
/** worker 的成功终态,走 worker 自己调的那个函数。 */
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "DONE", spent: true, finishedAt: new Date() } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}
function idOf(res: Awaited<ReturnType<typeof startAssetGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

/**
 * 一次「商家按下 Regenerate」的**请求体**。
 *
 * 每次调用返回一个**全新的对象**,这一点是这个文件的关键:服务端的可信记录挂在
 * 进程内的对象身份上(WeakMap),所以复用同一个对象就等于偷偷帮它去重了。刷新页面、
 * 第二个标签页、断线重发 —— 每一次都是一个新对象,这里必须照实模拟。
 */
function regenIntent(projectId: string, over: Record<string, unknown> = {}) {
  return {
    expectedCredits: 1,
    assetOp: "regen",
    assetAnchorGenerationId: "gen_source_1",
    projectId,
    prompt: "our mug on a linen table, morning light",
    entityIds: [],
    count: 1,
    kind: "image",
    model: IMAGE_ALIAS,
    aspectRatio: "1:1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("资产详情面板:同一个意图提交两次 = 一单一扣", () => {
  it("Regenerate 按两次(刷新 / 第二标签页 / 双击)⇒ 恰好一个 GenJob、恰好一行 RESERVE", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    // ① 第一次按下。
    const first = idOf(await startAssetGen(regenIntent(projectId)));
    expect(first.disposition).toBe("fresh");

    // ② 完全独立的第二次提交 —— 新对象、没有任何客户端状态可以借力。
    //    修好之前,这一次会拿到一个带新时间戳的键,于是变成第二单、第二次预扣。
    const second = idOf(await startAssetGen(regenIntent(projectId)));

    expect(second.id, "同一个意图必须落回同一单").toBe(first.id);
    expect(second.disposition).toBe("reused");

    const rows = await reserveRows(ownerId);
    expect(rows, "同一个意图只许有一行 RESERVE").toHaveLength(1);
    expect(rows[0]!.refId).toBe(first.id);
    expect(rows[0]!.reservedDelta).toBe(IMG);
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect((await account(ownerId)).reserved).toBe(IMG);
    expect((await account(ownerId)).balance).toBe(1000 - IMG);
  });

  it("键由服务端算出来:保留形状,而且与浏览器送来的任何东西无关", async () => {
    const ownerId = await seedOrg(100);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const res = idOf(await startAssetGen(regenIntent(projectId)));
    const [job] = await jobs(ownerId, projectId);

    expect(job!.id).toBe(res.id);
    expect(job!.idempotencyKey).toMatch(/^asset:regen:[0-9a-f]{64}$/);
  });

  it("键编进去的是浏览器送的公开别名,不是解析后的引擎名(#1029 留桩的机器版)", async () => {
    const ownerId = await seedOrg(100);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const intent = regenIntent(projectId);
    // 进摘要的是「请求体」:三个信封字段(价格绑定、动作、锚点)被 startAssetGen 摘出去,
    // 剩下的原样进 canonicalJson。这里照它的做法复现同一份。
    const body: Record<string, unknown> = { ...intent };
    for (const envelope of ["expectedCredits", "assetOp", "assetAnchorGenerationId"]) delete body[envelope];
    const anchor = intent.assetAnchorGenerationId;

    expect(idOf(await startAssetGen(intent)).disposition).toBe("fresh");
    const [job] = await jobs(ownerId, projectId);

    // 键是 64 位十六进制,别名不会**字面**出现在里面 —— 能钉住形状的是这两条一起:
    //   · 用浏览器送的那份请求体(`model: capability-image-N`)重算 = 落库的那个键;
    //   · 只把 `model` 换成解析后的引擎名、其余一字不改 ≠ 落库的那个键。
    // 因为摘要在 `startAssetGen` 里就算完,而别名→引擎的翻译(`resolvePublicModelAlias`)
    // 要到 `startGen` 里才跑。#1029 的留桩说的正是这个形状,这里把它变成机器钉住的话:
    // 哪天摘要改成在解析之后算(模型菜单动态化时就必须这么改),下面第二条会先红。
    expect(IMAGE_ALIAS).not.toBe(activeImageModel());
    expect(job!.idempotencyKey).toBe(assetActionKey("regen", anchor, body).key);
    expect(job!.idempotencyKey).not.toBe(
      assetActionKey("regen", anchor, { ...body, model: activeImageModel() }).key,
    );
  });

  it("并发双击(两个请求同时在飞)⇒ 项目 advisory 锁串行化,仍然只有一单一扣", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    // 串行化的第一道不是唯一索引,是项目 advisory 锁:create + reserve 那一笔事务一开头就
    // `SELECT pg_advisory_xact_lock(hashtextextended('project:<projectId>'))`(gen-actions.ts
    // 的 `startGen`),拿到锁之后在锁内再读一次同键的活跃单,所以后到的那个请求读到的是先到
    // 者、走 reused。`GenJob_active_idempotency_key` 唯一索引是第二道防线 —— 只在锁没兜住
    // 时用 P2002 兜底。这条用例断言的是两道合起来的结果。
    const [a, b] = await Promise.all([
      startAssetGen(regenIntent(projectId)),
      startAssetGen(regenIntent(projectId)),
    ]);

    expect(idOf(a).id).toBe(idOf(b).id);
    expect(await reserveRows(ownerId)).toHaveLength(1);
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
  });

  it("改一个字就是另一个意图 ⇒ 第二单、第二次预扣(合法购买没有被关死)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const first = idOf(await startAssetGen(regenIntent(projectId)));
    const changed = idOf(await startAssetGen(regenIntent(projectId, {
      prompt: "our mug on a linen table, evening light",
    })));

    expect(changed.id).not.toBe(first.id);
    expect(changed.disposition).toBe("fresh");
    const rows = await reserveRows(ownerId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reservedDelta)).toEqual([IMG, IMG]);
  });

  it("换一张底图(锚点变了)⇒ 各自独立的一单,互不去重", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const a = idOf(await startAssetGen(regenIntent(projectId)));
    const b = idOf(await startAssetGen(regenIntent(projectId, { assetAnchorGenerationId: "gen_source_2" })));

    expect(b.id).not.toBe(a.id);
    expect(await reserveRows(ownerId)).toHaveLength(2);
  });

  it("Animate 与 Edit 各走各的身份:同一张图上三个动作互不串台,各自只扣一次", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const animate = () => ({
      expectedCredits: 11,
      assetOp: "animate",
      assetAnchorGenerationId: "gen_source_1",
      projectId,
      prompt: "our mug on a linen table, morning light",
      entityIds: [],
      count: 1,
      kind: "video",
      model: VIDEO_ALIAS,
      sourceGenerationId: "gen_source_1",
      durationSeconds: 5,
      resolution: "720p",
    });
    const edit = () => ({
      expectedCredits: 1,
      assetOp: "edit",
      assetAnchorGenerationId: "gen_source_1",
      projectId,
      prompt: "make the mug red",
      entityIds: [],
      count: 1,
      kind: "image",
      model: IMAGE_ALIAS,
      aspectRatio: "1:1",
      sourceGenerationId: "gen_source_1",
    });

    const regen = idOf(await startAssetGen(regenIntent(projectId)));
    const anim1 = idOf(await startAssetGen(animate()));
    const edit1 = idOf(await startAssetGen(edit()));
    // …然后每一条各自被重放一次(刷新 / 第二标签页)。
    const anim2 = idOf(await startAssetGen(animate()));
    const edit2 = idOf(await startAssetGen(edit()));

    expect(new Set([regen.id, anim1.id, edit1.id]).size, "三个动作是三单").toBe(3);
    expect(anim2.id).toBe(anim1.id);
    expect(edit2.id).toBe(edit1.id);

    const rows = await reserveRows(ownerId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.reservedDelta).sort((x, y) => x - y)).toEqual([IMG, IMG, VIDEO_5S_720P]);
  });
});

describe("刻意重试:一单跑完之后,同样的意图是一次新的购买", () => {
  it("第一单 DONE 之后再按一次同样的 Regenerate ⇒ 新的一单、第二行 RESERVE", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const first = idOf(await startAssetGen(regenIntent(projectId)));
    // worker 交付并结算 —— 这一单从此不再活跃。
    await workerSettle(ownerId, first.id);

    const retry = idOf(await startAssetGen(regenIntent(projectId)));

    // 键是同一个(意图没变),但活跃唯一索引与两处复用查询都只认 QUEUED / GENERATING,
    // 所以终态的旧行不挡路:商家「再来一张」是真的再来一张,而且照收一次钱。
    const all = await jobs(ownerId, projectId);
    expect(retry.id).not.toBe(first.id);
    expect(retry.disposition).toBe("fresh");
    expect(all).toHaveLength(2);
    expect(all[0]!.idempotencyKey).toBe(all[1]!.idempotencyKey);
    expect(await reserveRows(ownerId)).toHaveLength(2);
  });
});

describe("浏览器不许自己出键", () => {
  it("请求里带 idempotencyKey ⇒ 出界,零建单、零预扣", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const result = await startAssetGen({
      ...regenIntent(projectId),
      idempotencyKey: `regen-gen_source_1-${Date.now()}`,
    });

    expect(result).toEqual({ error: "That generation request is out of bounds." });
    expect(await jobs(ownerId, projectId)).toHaveLength(0);
    expect(await reserveRows(ownerId)).toHaveLength(0);
    expect((await account(ownerId)).balance).toBe(1000);
  });
});

describe("模板弹窗:同一张底图 + 同一个模板 + 同一个答案 = 一单一扣", () => {
  it("同一次挂载内的重复提交 / server action 重发 ⇒ 落回同一单(旧的 tpl:<id>:<runId> 每次换 runId)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const templateRun = () => ({
      expectedCredits: 1,
      assetOp: "template",
      assetAnchorGenerationId: "gen_uploaded_photo",
      projectId,
      kind: "image",
      sourceGenerationId: "gen_uploaded_photo",
      prompt: "marketplace main image, clean white background",
      entityIds: [],
      count: 1,
      model: IMAGE_ALIAS,
      aspectRatio: "1:1",
    });

    const first = idOf(await startAssetGen(templateRun()));
    // 「弹窗重开一次」不是这个形状:关掉弹窗会把 TemplateModal 整个卸载(OttoTemplates 里
    // 是条件渲染),重开后 `sourceGenId` 回到初值 null 逼商家重传,重传拿到的是一个新的
    // generation id ⇒ 新锚点 ⇒ 新键 ⇒ 本来就该是新的一单。这里钉住的是同一次挂载内同一份
    // 请求体被提交两次(server action 重发、断线重连后的重放)。
    const resent = idOf(await startAssetGen(templateRun()));

    expect(resent.id).toBe(first.id);
    expect(resent.disposition).toBe("reused");
    expect(await reserveRows(ownerId)).toHaveLength(1);
    const [job] = await jobs(ownerId, projectId);
    expect(job!.idempotencyKey).toMatch(/^asset:template:[0-9a-f]{64}$/);
  });
});
