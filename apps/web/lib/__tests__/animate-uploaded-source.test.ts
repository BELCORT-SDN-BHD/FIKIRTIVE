/**
 * 缺陷 D5（2026-09-03 真供应商走查实证）—— **上传进来的素材也能 Animate。**
 *
 * 现场是什么样:商家自己拍的产品照上传进来,在资产详情面板按「Animate」,服务端一律回
 * 「That generation request is out of bounds.」,连一个 GenJob 都不建。差分证据当场就在
 * 同一张图上:打了字的「Generate edit」能建单,空提示词的「Animate」建不了;而生成出来的
 * 图(提示词非空)一按就建单。
 *
 * 机理:上传路把 `Generation.promptText` 写成空串(`apps/web/lib/actions.ts` /
 * `upload-actions.ts`),面板把那一列原样当请求的 `prompt` 送出去
 * (`components/asset/DetailPanel.tsx` 的 `prompt: gen.prompt`),而 `genRequest` 要求
 * `prompt` 非空(`packages/core/src/gen.ts`)—— 整单在 schema 那一步被拒。裁剪那条路早有
 * 同族兜底(`source.promptText || "cropped"`),Animate 没补。
 *
 * 兜底**只给 Animate**(2026-09-03 裁决,规格变更登记有案):`handleAnimate` 送
 * `sourceGenerationId`,引擎真看得见那张照片,所以「Animate this image」是句成立的指令。
 * `handleRegen` 不送(`DetailPanel.tsx`),那条路今天是纯文生图 —— 兜一句「Recreate this
 * image」只会让商家花钱拿到一张无关的图,比 $0 拒收更糟。所以下面第四条钉的是反面:
 * 上传素材按 Regenerate **必须原地被拒**,$0、连 GenJob 都不建。
 *
 * 这个文件跑在真 Postgres(*_test)、真 Prisma、真积分台账上,与
 * `asset-idempotency-ledger.test.ts` 同一套周边假件(auth guard、impersonation、队列、
 * guardian、机型开关、next/cache)。零 provider 调用,零真实花费。
 *
 * 验收落点:CREATE-A3(`docs/specs/creation-engine.md`,已冻结 v2)—— 声音开关住在资产
 * 详情 Animate 这条路上。上传素材按不动 Animate,等于这条路上的声音开关对上传素材根本
 * 不存在,所以这一族断言连着钉:建得出单、**开关值原样落进 `GenJob.videoOptions`**、
 * 账本恰好一行 RESERVE、且开关不改报价。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, ASSET_ACTION_FALLBACK_PROMPTS } from "@fikirtive/core";

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
const { prisma } = await import("@fikirtive/db");

const VIDEO_5S_720P = 11 * INTERNAL_PER_DISPLAY; // seedance-2-mini 720p/5s(#644 裁决)

// 引擎名从来不出浏览器:四个付费入口送的都是 `getActiveGenModels()` 回的公开别名。
const ACTIVE = await getActiveGenModels();
const IMAGE_ALIAS = ACTIVE.image;
const VIDEO_ALIAS = ACTIVE.video;

// ── real-DB helpers ──────────────────────────────────────────────────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "D5 animate upload" } });
  return id;
}

/**
 * 一张**真的上传进来的**素材 —— 与产线上传路逐字同形(`actions.ts` 的那一段):
 * `source: UPLOAD` + `promptText: ""`。测试不自己编一个「空提示词」的概念,它就是这一列。
 */
async function seedUploadedGeneration(ownerId: string, projectId: string): Promise<string> {
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId,
      ownerId,
      contentHash: randomUUID().replace(/-/g, ""),
      ext: "jpg",
      mime: "image/jpeg",
      sizeBytes: BigInt(120_000),
      originalFilename: "my-product-photo.jpg",
      source: "UPLOAD",
    },
  });
  const genId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: genId,
      ownerId,
      projectId,
      shotId: null,
      assetId,
      source: "UPLOAD",
      promptText: "",
      entitySnapshot: { entities: [] },
    },
  });
  return genId;
}

/** 一张**引擎生成出来的**图:提示词非空 —— 修好之前这一条本来就建得出单。 */
async function seedGeneratedGeneration(ownerId: string, projectId: string, prompt: string): Promise<string> {
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId,
      ownerId,
      contentHash: randomUUID().replace(/-/g, ""),
      ext: "jpg",
      mime: "image/jpeg",
      sizeBytes: BigInt(90_000),
      source: "GENERATED",
    },
  });
  const genId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: genId,
      ownerId,
      projectId,
      shotId: null,
      assetId,
      source: "GENERATED",
      promptText: prompt,
      entitySnapshot: { entities: [] },
    },
  });
  return genId;
}

/** 面板真正送出去的那一句,就是这一列 —— 测试不在别处另抄一份「空」。 */
async function panelPrompt(ownerId: string, generationId: string): Promise<string> {
  const row = await prisma.generation.findFirstOrThrow({
    where: { id: generationId, ownerId },
    select: { promptText: true },
  });
  return row.promptText;
}

async function reserveRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId, kind: "RESERVE" }, orderBy: { createdAt: "asc" } });
}
async function jobs(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({
    where: { ownerId, projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, kind: true, prompt: true, requestedPrompt: true, videoOptions: true, idempotencyKey: true },
  });
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}
function idOf(res: Awaited<ReturnType<typeof startAssetGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

/** 面板 `handleAnimate` 送出去的那一份请求体,逐字同形(DetailPanel.tsx)。 */
function animateIntent(projectId: string, sourceGenId: string, prompt: string, audio: boolean) {
  return {
    expectedCredits: 11,
    assetOp: "animate",
    assetAnchorGenerationId: sourceGenId,
    projectId,
    prompt,
    entityIds: [],
    count: 1,
    kind: "video",
    model: VIDEO_ALIAS,
    sourceGenerationId: sourceGenId,
    durationSeconds: 5,
    resolution: "720p",
    audio,
  };
}

/** 面板 `handleRegen` 送出去的那一份(注意:这条路不带 sourceGenerationId)。 */
function regenIntent(projectId: string, anchorGenId: string, prompt: string) {
  return {
    expectedCredits: 1,
    assetOp: "regen",
    assetAnchorGenerationId: anchorGenId,
    projectId,
    prompt,
    entityIds: [],
    count: 1,
    kind: "image",
    model: IMAGE_ALIAS,
    aspectRatio: "1:1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("D5:上传素材按 Animate", () => {
  it("CREATE-A3 —— 上传的图(promptText 空)按 Animate ⇒ 建得出单,声音开关原样落进 videoOptions,账本恰好一行 RESERVE", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const uploaded = await seedUploadedGeneration(ownerId, projectId);

    // 面板送的就是那一列 —— 空串。修好之前,这一行整单被拒。
    expect(await panelPrompt(ownerId, uploaded), "上传路写的就是空串").toBe("");

    const started = idOf(await startAssetGen(
      animateIntent(projectId, uploaded, await panelPrompt(ownerId, uploaded), false),
    ));
    expect(started.disposition).toBe("fresh");

    const all = await jobs(ownerId, projectId);
    expect(all, "GenJob 必须真的建出来").toHaveLength(1);
    const [job] = all;
    expect(job!.kind).toBe("VIDEO");
    // 兜底句进的是「实发」那一栏,不是商家原话那一栏。
    expect(job!.prompt).toBe(ASSET_ACTION_FALLBACK_PROMPTS.animate);
    expect(job!.requestedPrompt, "兜底句绝不冒充商家原话").toBeNull();
    // CREATE-A3:关掉的开关必须原样留在快照里(worker 只读这一列)。
    expect(job!.videoOptions).toMatchObject({ seconds: 5, resolution: "720p", audio: false });
    expect(job!.idempotencyKey).toMatch(/^asset:animate:[0-9a-f]{64}$/);

    const rows = await reserveRows(ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reservedDelta).toBe(VIDEO_5S_720P);
  });

  it("CREATE-A3 —— 声音开关开着的同一张上传图:照样建单,且报价一格没动(11cr 两次都通过绑定)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const uploaded = await seedUploadedGeneration(ownerId, projectId);
    const prompt = await panelPrompt(ownerId, uploaded);

    // 同一档规格、同一个价格绑定,只有声音开关不同 —— 两次都必须被受理。
    // 服务端自己算一遍价再比对,所以「两次都用 11 过得去」= 开关不改价。
    const off = idOf(await startAssetGen(animateIntent(projectId, uploaded, prompt, false)));
    const on = idOf(await startAssetGen(animateIntent(projectId, uploaded, prompt, true)));

    expect(on.id, "开关是意图的一部分 ⇒ 另一个键 ⇒ 另一单").not.toBe(off.id);
    const all = await jobs(ownerId, projectId);
    expect(all).toHaveLength(2);
    expect(all.map((j) => (j.videoOptions as { audio: boolean }).audio).sort()).toEqual([false, true]);
    const rows = await reserveRows(ownerId);
    expect(rows.map((r) => r.reservedDelta)).toEqual([VIDEO_5S_720P, VIDEO_5S_720P]);
  });

  it("CREATE-A3 —— 同一张上传图连按两次 Animate(刷新 / 第二标签页)⇒ 仍然一单一扣", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const uploaded = await seedUploadedGeneration(ownerId, projectId);
    const prompt = await panelPrompt(ownerId, uploaded);

    const first = idOf(await startAssetGen(animateIntent(projectId, uploaded, prompt, false)));
    const second = idOf(await startAssetGen(animateIntent(projectId, uploaded, prompt, false)));

    // 兜底句在算键**之前**落下,所以同一个意图两次提交摘出同一个键 —— 兜底没有把
    // 去重打穿(那才是这条路上最贵的一类缺陷)。
    expect(second.id).toBe(first.id);
    expect(second.disposition).toBe("reused");
    expect(await reserveRows(ownerId)).toHaveLength(1);
  });
});

describe("D5:Regenerate 没有源图,维持拒收", () => {
  it("CREATE-A3 —— 上传的图按 Regenerate ⇒ 原地拒收、$0、连 GenJob 都不建(兜底句只给 Animate)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const uploaded = await seedUploadedGeneration(ownerId, projectId);

    // `regenIntent` 与面板 `handleRegen` 逐字同形 —— **没有 `sourceGenerationId`**。
    // 引擎手上没有这张照片,兜一句话过去只会出一张无关的图,而商家已经付了钱。
    // 所以这条路上「拒收」才是正确结果,直到 i2i 请求形状接上。
    const result = await startAssetGen(
      regenIntent(projectId, uploaded, await panelPrompt(ownerId, uploaded)),
    );

    expect(result).toEqual({ error: "That generation request is out of bounds." });
    expect(await jobs(ownerId, projectId), "拒收就必须一单都不建").toHaveLength(0);
    expect(await reserveRows(ownerId), "$0:账本一行都不许动").toHaveLength(0);
    expect((await account(ownerId)).balance).toBe(1000);
    // 兜底表本身是这条断言的单一来源:regen 一旦被加回去,上面四行立刻红。
    expect(Object.keys(ASSET_ACTION_FALLBACK_PROMPTS), "兜底只留 Animate 一条").toEqual(["animate"]);
  });
});

describe("D5:兜底收得很窄", () => {
  it("CREATE-A3 —— 生成图(提示词非空)的 Animate 零回归:发出去的还是商家那句话", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const generated = await seedGeneratedGeneration(ownerId, projectId, "our mug on a linen table, morning light");
    const prompt = await panelPrompt(ownerId, generated);

    idOf(await startAssetGen(animateIntent(projectId, generated, prompt, true)));

    const all = await jobs(ownerId, projectId);
    expect(all).toHaveLength(1);
    expect(all[0]!.prompt, "商家写了字,兜底一个字都不许插手").toBe("our mug on a linen table, morning light");
    expect((all[0]!.videoOptions as { audio: boolean }).audio).toBe(true);
    expect(await reserveRows(ownerId)).toHaveLength(1);
  });

  it("CREATE-A3 —— Generate edit 空输入照旧拒收:那句话是商家自己敲的字,没有兜底可言", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const uploaded = await seedUploadedGeneration(ownerId, projectId);

    const result = await startAssetGen({
      expectedCredits: 1,
      assetOp: "edit",
      assetAnchorGenerationId: uploaded,
      projectId,
      prompt: "   ",
      entityIds: [],
      count: 1,
      kind: "image",
      model: IMAGE_ALIAS,
      aspectRatio: "1:1",
      sourceGenerationId: uploaded,
    });

    expect(result).toEqual({ error: "That generation request is out of bounds." });
    expect(await jobs(ownerId, projectId)).toHaveLength(0);
    expect(await reserveRows(ownerId)).toHaveLength(0);
    expect((await account(ownerId)).balance).toBe(1000);
  });
});
