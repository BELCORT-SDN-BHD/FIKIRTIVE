/**
 * anchored-aspect-provider-e2e —— #775 判官 r7 P1:**一路走到适配器边界**的探针。
 *
 * 为什么必须有这个文件(判词说得对):`anchored-aspect-e2e.test.ts` 自称验的是「最后写进
 * GenJob 的那个值」,实际只调到 `normalizeFactoryMaterial` 就把**中间产物**返回了 ——
 * 没穿 `startGen`、没读真的 GenJob 行、没执行 worker。于是只要将来有人在归一化**之后**
 * 把 aspect 改回 16:9(startGen 里改、worker 里改、迁移里改都算),那份测试仍旧全绿,
 * 而商家照样掉进异步失败。一条链子分两段验、中间没人接,正是 r5 那条缝的成因;
 * 在同一张票上重犯第二次没有道理。
 *
 * 所以这里一段都不隔:
 *
 *   `genRequest` 形状 → 真 `startGen`(真 Postgres、真预扣、真 GenJob 落库)
 *      → 从**库里读回来**的那一行 → 真 `handleGen` → `provider.generateVideo` 实收的参数。
 *
 * 只有两样是假的,而且都必须假:**付费引擎**(绝不真调用、绝不真花钱)与**对象存储**
 * (不需要真 R2)。库、钱、事务、归一化、worker 全是真的。适配器那一层的入参断言
 * 就是「商家的钱最终买到了什么形状」——它是这条链子上唯一说了算的读数。
 *
 * 覆盖判官点名的三条:剪辑锚定、续写锚定(两条都必须实收 adaptive),外加一条
 * **普通文生视频**对照(实收仍是模型默认 16:9)—— 少了对照,「全都改成 adaptive」
 * 这种过度收紧也会绿。
 *
 * 与 `gen-image-shape.test.ts` 的分工:那份把 job 行手搓出来喂 worker,验的是
 * 「worker 透传得对不对」;这份不许手搓 —— job 必须由真路径**诞生**,验的是
 * 「从请求到引擎,这个值中途有没有被谁改掉」。两份都要,少哪一份都有一段没人看。
 *
 * 超时给足:每条用例都要建租户、真预扣、跑完 startGen 与整条 handleGen。
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { VIDEO_ASPECT_ADAPTIVE, videoDefaults, type GenVideoModel } from "@fikirtive/core";

// ── web 侧管道(与 gen-ledger.test.ts 同一份):鉴权、缓存、队列、守卫、模型开关。
//    `@fikirtive/db` 故意**不**mock —— 这条探针的全部意义就是那一行真的落库。
const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({ send: vi.fn(async (_n: string, _d: unknown, o: { id?: string }) => o.id ?? null) })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

// ── worker 侧:只把**付费引擎**与**对象存储**换成假件。worker 的库、钱、归一化读取全是真的。
const w = vi.hoisted(() => ({
  generateVideo: vi.fn(),
  generateImages: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../../../worker/src/storage.js", () => ({
  storage: { put: w.storagePut, presignedGet: w.storagePresignedGet },
}));
vi.mock("../../../worker/src/generation.js", () => ({
  provider: { name: "byteplus", generate: w.generateImages, generateVideo: w.generateVideo },
}));
vi.mock("../../../worker/src/model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

const { startGen } = await import("../gen-actions");
const { handleGen } = await import("../../../worker/src/jobs/gen.js");
const { prisma } = await import("@fikirtive/db");

const MODEL: GenVideoModel = "seedance-2-mini";
const CASE_TIMEOUT_MS = 60_000;

/** 官方锚定句式的两条真句子(装配器产出的形状:opening + 空格 + 内容 + 句号)。 */
const EDIT_PROMPT = "Strictly edit <Video_1>, and modify the shop sign to read OPEN.";
const EXTEND_PROMPT = "Extend <Video_1> forward, keeping the same slow push-in.";
const PLAIN_PROMPT = "A calm product shot on a white table, soft daylight.";

let ownerId: string;
let projectId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // 付掉连接池与 query engine 的冷启动
}, CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  w.storagePresignedGet.mockImplementation(async (key: string) => `https://storage.test/${key}`);
  // 内容寻址:每次 put 一个新哈希,产出行才会真写出来(Asset 的 ownerId+contentHash 唯一)
  w.storagePut.mockImplementation(async () => ({
    contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
  }));
  w.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), ext: "mp4" });

  ownerId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance: 100_000, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Anchored aspect probe" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}, CASE_TIMEOUT_MS);

/** 商家手里那条真片子:一行 Asset(视频扩展名、时长在 2–6s 闸内)+ 一行 Generation。
 *  worker 会按 ownerId/projectId/deletedAt/ext 把它查出来并 presign —— 少任何一格都会
 *  走 fail-closed 退款路,那样这条探针根本到不了适配器。 */
async function seedClip(): Promise<string> {
  const assetId = `ast_${randomUUID()}`;
  const generationId = `gen_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId,
      ownerId,
      contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      ext: "mp4",
      mime: "video/mp4",
      sizeBytes: BigInt(1024),
      durationS: 5,
    },
  });
  await prisma.generation.create({
    data: {
      id: generationId,
      ownerId,
      projectId,
      assetId,
      source: "UPLOAD",
      promptText: "the clip the merchant already has",
      entitySnapshot: { entities: [] },
    },
  });
  return generationId;
}

/**
 * 一整条链子跑一遍,交回**两个真实读数**:库里那一行冻的是什么、适配器实收的是什么。
 *
 * 刻意不接受任何「期望值」参数,也不在中途重算 —— 它只负责把真路径跑完并把两处
 * 读数原样端出来,断言留给用例。中途任何一站把值改掉,这里都会如实反映。
 */
async function aspectThroughTheWholeChain(req: Record<string, unknown>): Promise<{
  persisted: string | undefined;
  received: string | undefined;
}> {
  const started = await startGen({
    projectId,
    kind: "video",
    model: MODEL,
    count: 1,
    entityIds: [],
    idempotencyKey: `probe:${randomUUID()}`,
    ...req,
  });
  if ("error" in started) throw new Error(`startGen refused this request: ${started.error}`);

  // 库里真的那一行(不是 startGen 的返回值,不是内存里的 material)
  const row = await prisma.genJob.findFirstOrThrow({
    where: { id: started.id, ownerId },
    select: { videoOptions: true, status: true, prompt: true },
  });
  expect(row.status, "作业必须真的排上队,后面的 worker 断言才有意义").toBe("QUEUED");

  await handleGen({ genJobId: started.id }, 0);

  expect(w.generateVideo, "付费调用必须真的发生过,这条断言才有意义").toHaveBeenCalledTimes(1);
  const sent = w.generateVideo.mock.calls[0]![0] as { aspectRatio?: string };
  return {
    persisted: (row.videoOptions as { aspectRatio?: string } | null)?.aspectRatio,
    received: sent.aspectRatio,
  };
}

describe("#775 判官 r7 —— 锚定请求的形状,一路走到适配器都没被谁改掉", () => {
  it(
    "剪辑:官方句式 + 真 clip + 不传 aspect ⇒ 库里冻的是 adaptive,适配器实收 adaptive",
    async () => {
      const clip = await seedClip();
      const { persisted, received } = await aspectThroughTheWholeChain({
        prompt: EDIT_PROMPT,
        referenceVideoGenerationId: clip,
      });
      expect(persisted).toBe(VIDEO_ASPECT_ADAPTIVE);
      expect(received).toBe(VIDEO_ASPECT_ADAPTIVE);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "续写:官方句式 + 真 clip + 不传 aspect ⇒ 库里冻的是 adaptive,适配器实收 adaptive",
    async () => {
      const clip = await seedClip();
      const { persisted, received } = await aspectThroughTheWholeChain({
        prompt: EXTEND_PROMPT,
        referenceVideoGenerationId: clip,
      });
      expect(persisted).toBe(VIDEO_ASPECT_ADAPTIVE);
      expect(received).toBe(VIDEO_ASPECT_ADAPTIVE);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "剪辑:商家明确要 adaptive ⇒ 同样一路 adaptive(显式与缺席落在同一处)",
    async () => {
      const clip = await seedClip();
      const { persisted, received } = await aspectThroughTheWholeChain({
        prompt: EDIT_PROMPT,
        referenceVideoGenerationId: clip,
        aspectRatio: VIDEO_ASPECT_ADAPTIVE,
      });
      expect(persisted).toBe(VIDEO_ASPECT_ADAPTIVE);
      expect(received).toBe(VIDEO_ASPECT_ADAPTIVE);
    },
    CASE_TIMEOUT_MS,
  );

  // 对照组。没有它,「把所有视频都改成 adaptive」这种过度收紧同样全绿 ——
  // 而那会把商家在画布上亲手选的形状悄悄丢掉,是另一个方向的同类缺陷。
  it(
    "普通文生视频 + 不传 aspect ⇒ 一格没动:库里与适配器都是模型默认 16:9",
    async () => {
      const { persisted, received } = await aspectThroughTheWholeChain({ prompt: PLAIN_PROMPT });
      expect(videoDefaults(MODEL).aspectRatio, "对照组的前提:这个模型的默认就是 16:9").toBe("16:9");
      expect(persisted).toBe("16:9");
      expect(received).toBe("16:9");
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "普通文生视频 + 商家亲手选了 9:16 ⇒ 原样送到适配器(锚定那条规矩碰不到它)",
    async () => {
      const { persisted, received } = await aspectThroughTheWholeChain({
        prompt: PLAIN_PROMPT,
        aspectRatio: "9:16",
      });
      expect(persisted).toBe("9:16");
      expect(received).toBe("9:16");
    },
    CASE_TIMEOUT_MS,
  );
});
