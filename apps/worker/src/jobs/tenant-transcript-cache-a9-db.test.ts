/**
 * tenant-transcript-cache-a9-db.test.ts —— 规格 docs/specs/tenant-isolation.md 验收 **TENANT-A9**：
 * 「用同一段音频同一模型，在两个不同租户下各跑一次转写 ⇒ 第二次命中全局缓存、不报错、不重复
 * 计费；换成任何其它表的跨租户读则被拒。」
 *
 * 这一条是规格 §1.6 两类豁免里的第二类（per-(model, uniqueKey)：`Transcript × contentHash_model`）
 * ——「同音频同模型 $0 复用」是它存在的全部理由，所以证据必须是**转写引擎到底被调用了几次**，
 * 不是「缓存函数被 mock 断言调用过」。这里打真库、真守卫、真 `handleCaption`；唯一的替身是
 * `execa`（ffmpeg / ffprobe / whisper-cli 三个外部二进制，开发机与 CI 都没有），它按生产的调用
 * 形状把 whisper 的 JSON 真的写到 handler 指定的输出路径上 —— 于是「whisper-cli 被 execa 调了
 * 几次」就是「商家被跑了几次转写」的逐字对应。
 *
 * `../storage.js` 不是另写的替身：用的是 `LocalDiskStorage` —— 生产工厂 `createStorage()`
 * （`apps/worker/src/storage.ts:9`）在 `STORAGE_DRIVER` 不设时返回的正是这个类
 * （`packages/storage/src/index.ts:946-964`），也就是 dev/CI 每天跑的那一条存储路；staging 与
 * production 今天跑 `STORAGE_DRIVER=r2`，同一个工厂返回的是 `R2Storage`，那条存储路本文件不覆盖。
 * 这里只把根目录换成临时目录，并在 `ffmpegInput` 前挂一个**帧内探针** —— 第三条用例的跨租户读
 * 必须发生在 `handleCaption` 自己那个帧里（`runAsTenant(job.ownerId)`），不是测试另开一个帧假装。
 *
 * ── 这个文件证不到、因此不在这里断言的一件事 ────────────────────────────────────────────────
 * 规格 §1.6 写的豁免是 **per-(model, uniqueKey)**，「不得退化成整模型豁免」。而今天的实现里
 * `Transcript` 是整张表进 `TENANT_GUARD_EXEMPT`（packages/db/src/tenant-guard.ts），不是只对
 * `contentHash_model` 这一把键开口。所以 A9 的缓存命中今天不依赖任何 per-uniqueKey 特判，
 * 这个文件也就没有办法把「特判只对这一把键生效」证出来。两者的差距记在 PR 里，不在这里
 * 断言成「对」。
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const h = vi.hoisted(() => {
  const dataDir = `${process.env.TMPDIR ?? "/tmp"}/fikirtive-tenant-a9-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let probe: null | (() => Promise<void>) = null;
  return {
    dataDir,
    execa: vi.fn(),
    arm(p: () => Promise<void>) {
      probe = p;
    },
    async fire() {
      const p = probe;
      if (!p) return;
      probe = null;
      await p();
    },
  };
});

vi.mock("execa", () => ({ execa: h.execa }));

vi.mock("../storage.js", async () => {
  const actual = await vi.importActual<typeof import("@fikirtive/storage")>("@fikirtive/storage");
  const real = new actual.LocalDiskStorage(h.dataDir);
  const ffmpegInput = real.ffmpegInput.bind(real);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (real as any).ffmpegInput = async (...a: Parameters<typeof ffmpegInput>) => {
    await h.fire();
    return ffmpegInput(...a);
  };
  return { storage: real };
});

import { prisma } from "@fikirtive/db";
import { getPrincipal, runAsTenant } from "@fikirtive/db/principal";
import { newId, storageKey, TRANSCRIPT_GENERATION } from "@fikirtive/core";
import { storage } from "../storage.js";
import { handleCaption } from "./caption.js";

// 同本目录其它真库用例的守卫：绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const A = `a9a-${randomUUID()}`;
const B = `a9b-${randomUUID()}`;
const START = 500_000;

const PROBE_JSON = JSON.stringify({
  format: { duration: "5" },
  streams: [{ codec_type: "video", width: 640, height: 360 }, { codec_type: "audio" }],
});
const WHISPER_JSON = JSON.stringify({
  result: { language: "ms" },
  transcription: [{ offsets: { from: 0, to: 900 }, text: " Terima kasih" }],
});

/** 商家被真正跑了几次转写 —— whisper-cli 的调用次数，逐字对应。
 *  这是**文件级累计值**，所以每条用例都先在自己开头取一次快照、只断差值，绝不断绝对数。 */
function transcribeCalls() {
  return h.execa.mock.calls.filter((c) => c[0] === "whisper-cli").length;
}

async function rejection(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "NO REJECTION —— 跨租户读没有被拒";
}

/** 一段音频的字节 + 它真实的 sha256。两个租户各自把**同一份字节**放进自己那把 key 下。 */
const AUDIO = randomBytes(128);
const AUDIO_HASH = createHash("sha256").update(AUDIO).digest("hex");

/** 第三条用例用的另一段音频（内容不同 ⇒ 缓存必然未命中 ⇒ 走完整路 ⇒ 帧内探针有机会跑）。 */
const OTHER_AUDIO = randomBytes(128);
const OTHER_HASH = createHash("sha256").update(OTHER_AUDIO).digest("hex");

async function seedAsset(owner: string, bytes: Uint8Array, hash: string) {
  const { contentHash } = await storage.put(owner, bytes, "mp4");
  expect(contentHash).toBe(hash); // 内容寻址：两个租户的同一段音频必然同一个哈希
  const id = newId();
  await prisma.asset.create({
    data: {
      id,
      ownerId: owner,
      contentHash: hash,
      ext: "mp4",
      mime: "video/mp4",
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: "voiceover.mp4",
      source: "UPLOAD",
    },
  });
  return { id, key: storageKey(owner, hash, "mp4") };
}

async function seedCaptionJob(owner: string, assetId: string, contentHash: string) {
  const id = newId();
  await prisma.captionJob.create({
    data: { id, ownerId: owner, projectId: newId(), assetId, contentHash, status: "QUEUED" },
  });
  return id;
}

/** ② 的前提：「A 家已经把这段音频转写过一次」。① 跑过就是空操作；单独跑 ②（`-t` / `--shard` /
 *  vitest retry）时由它自己把 A 家那一单补上 —— 用例因此不依赖同文件的执行顺序。 */
async function ensureTenantATranscribed(): Promise<void> {
  const cached = await prisma.transcript.findMany({
    where: { contentHash: AUDIO_HASH, model: TRANSCRIPT_GENERATION },
  });
  if (cached.length > 0) return;
  const jobA = await seedCaptionJob(A, assetA, AUDIO_HASH);
  await handleCaption({ captionJobId: jobA }, 0);
}

/** 一家店在钱上的全部痕迹：账本行数 + 账户余额。缓存命中这一路必须一格不动。 */
async function moneyTrail(org: string) {
  const rows = await prisma.creditLedger.count({ where: { orgId: org } });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId: org }, select: { balance: true, reserved: true } });
  return { rows, balance: account.balance, reserved: account.reserved };
}

let assetA = "";
let assetB = "";
let generationA = "";

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  h.execa.mockImplementation(async (bin: string, args: string[]) => {
    if (bin === "ffprobe") return { stdout: PROBE_JSON };
    if (bin === "ffmpeg") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(String(args[args.length - 1]), randomBytes(32));
      return { stdout: "" };
    }
    if (bin === "whisper-cli") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${String(args[args.indexOf("-of") + 1])}.json`, WHISPER_JSON);
      return { stdout: "" };
    }
    return { stdout: "" };
  });

  await prisma.organization.create({ data: { id: A, name: "a9-tenant-a" } });
  await prisma.organization.create({ data: { id: B, name: "a9-tenant-b" } });
  await prisma.creditAccount.create({ data: { orgId: A, balance: START, reserved: 0 } });
  await prisma.creditAccount.create({ data: { orgId: B, balance: START, reserved: 0 } });

  // 同一段音频，两个租户各自上传一次（内容寻址 ⇒ 同一个 contentHash，各自的 key 下各一份字节）。
  assetA = (await seedAsset(A, AUDIO, AUDIO_HASH)).id;
  assetB = (await seedAsset(B, AUDIO, AUDIO_HASH)).id;

  // A 名下一行 Generation —— 第三条用例要证「换成其它表的跨租户读同样被拒」，拿它当靶子。
  generationA = newId();
  await prisma.project.create({ data: { id: `prj_${randomUUID()}`, ownerId: A, name: "A9" } });
  const projectA = await prisma.project.findFirstOrThrow({ where: { ownerId: A }, select: { id: true } });
  await prisma.generation.create({
    data: { id: generationA, ownerId: A, projectId: projectA.id, assetId: assetA, source: "UPLOAD", entitySnapshot: { entities: [] } },
  });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  for (const owner of [A, B]) {
    await runAsTenant(owner, async () => {
      await prisma.captionJob.deleteMany({ where: { ownerId: owner } });
      await prisma.transcript.deleteMany({ where: { ownerId: owner } });
      await prisma.generation.deleteMany({ where: { ownerId: owner } });
      await prisma.assetUnderstanding.deleteMany({ where: { ownerId: owner } });
      await prisma.asset.deleteMany({ where: { ownerId: owner } });
      await prisma.project.deleteMany({ where: { ownerId: owner } });
      await prisma.actionEvent.deleteMany({ where: { ownerId: owner } });
    });
    await prisma.creditLedger.deleteMany({ where: { orgId: owner } });
    await prisma.creditAccount.deleteMany({ where: { orgId: owner } });
    await prisma.organization.deleteMany({ where: { id: owner } });
  }
  await prisma.$disconnect();
  // 真字节写在 `h.dataDir` 这个临时根目录下 —— 跑完自己收掉，别在开发机与 CI 上越积越多。
  // 先例：apps/worker/src/jobs/gen-output-dimensions.test.ts:223。
  await rm(h.dataDir, { recursive: true, force: true });
}, DB_CASE_TIMEOUT_MS);

describe("TENANT-A9 —— 同音频同模型跨租户复用全局缓存，其它表的跨租户读照拒（真库、真守卫）", () => {
  it("TENANT-A9 ① A 家先跑：转写真的跑了一次，结果按 (contentHash, model) 落进全局缓存", async () => {
    const callsAtCaseStart = transcribeCalls(); // 本用例自己的基线，不是文件开头的 0
    const jobA = await seedCaptionJob(A, assetA, AUDIO_HASH);

    await handleCaption({ captionJobId: jobA }, 0);

    expect(transcribeCalls() - callsAtCaseStart).toBe(1);
    const job = await prisma.captionJob.findFirstOrThrow({ where: { id: jobA, ownerId: A } });
    expect(job.status).toBe("DONE");
    expect(job.error).toBe("");
    const cached = await prisma.transcript.findMany({ where: { contentHash: AUDIO_HASH, model: TRANSCRIPT_GENERATION } });
    expect(cached).toHaveLength(1);
    expect(cached[0]!.ownerId).toBe(A); // 第一个写进去的人挂着名，这一行此后是全局的
    expect(cached[0]!.cuesJson).toEqual([{ startMs: 0, lengthMs: 900, text: "Terima kasih" }]);
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A9 ② B 家拿同一段音频同一模型：命中缓存 —— 第二次转写调用为 0、任务 DONE 无错、两边账本一行没多", async () => {
    // 前提自己保证：① 跑过就是空操作，单独跑这一条时由它把 A 家那一单补上。
    await ensureTenantATranscribed();
    const callsAtCaseStart = transcribeCalls(); // 本用例自己的基线（累计值只做差）
    const moneyABefore = await moneyTrail(A);
    const moneyBBefore = await moneyTrail(B);
    const jobB = await seedCaptionJob(B, assetB, AUDIO_HASH);

    await handleCaption({ captionJobId: jobB }, 0);

    // ① 没有第二次转写 —— 这就是「$0 复用」的全部内容
    expect(transcribeCalls() - callsAtCaseStart).toBe(0);
    // ② 不报错，正常终态
    const job = await prisma.captionJob.findFirstOrThrow({ where: { id: jobB, ownerId: B } });
    expect(job.status).toBe("DONE");
    expect(job.progress).toBe(100);
    expect(job.error).toBe("");
    // ③ 缓存行还是那一行（没有给 B 复制出第二行），归属没被改写
    const cached = await prisma.transcript.findMany({ where: { contentHash: AUDIO_HASH, model: TRANSCRIPT_GENERATION } });
    expect(cached).toHaveLength(1);
    expect(cached[0]!.ownerId).toBe(A);
    // ④ 不重复计费：两家的账本行数与余额分毫未动（caption 这条队列本就不扣费，
    //    所以「没多一行」的基线是 0 —— 命中缓存也不许凭空多出任何一笔）
    expect(await moneyTrail(B)).toEqual(moneyBBefore);
    expect(await moneyTrail(A)).toEqual(moneyABefore);
    expect(moneyBBefore).toEqual({ rows: 0, balance: START, reserved: 0 });
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A9 ③ 换成其它表：B 的帧内点名 A 的 Asset / Generation，两笔跨租户读都被值比对拒掉", async () => {
    const jobB2 = await seedCaptionJob(B, (await seedAsset(B, OTHER_AUDIO, OTHER_HASH)).id, OTHER_HASH);
    const probe: { principal?: unknown; asset?: string; generation?: string; scopedAsset?: unknown; scopedGeneration?: unknown } = {};

    // 探针挂在 handleCaption 帧内一定会碰的那个边界上（storage.ffmpegInput），所以下面这两笔
    // 跨租户读发生在**真实的那个帧**里，不是测试自己另开的帧。
    h.arm(async () => {
      probe.principal = getPrincipal();
      probe.asset = await rejection(() => prisma.asset.findMany({ where: { ownerId: A } }));
      probe.generation = await rejection(() => prisma.generation.findMany({ where: { ownerId: A } }));
      // 同一个帧里，不点名租户的按 id 单行读只是「看不见」而不是抛错 —— 两种拒绝形状都记下来。
      probe.scopedAsset = await prisma.asset.findUnique({ where: { id: assetA } });
      probe.scopedGeneration = await prisma.generation.findUnique({ where: { id: generationA } });
    });

    await handleCaption({ captionJobId: jobB2 }, 0);

    expect(probe.principal).toMatchObject({ kind: "system", reason: "tenant-direct", ownerId: B });
    expect(probe.asset).toBe("[tenant-guard] Asset.findMany tried to use ownerId outside the active tenant");
    expect(probe.generation).toBe("[tenant-guard] Generation.findMany tried to use ownerId outside the active tenant");
    expect(probe.scopedAsset).toBeNull();
    expect(probe.scopedGeneration).toBeNull();
    // A 的那两行一个字没被碰过
    expect(await prisma.asset.findFirst({ where: { id: assetA, ownerId: A } })).toBeTruthy();
    expect(await prisma.generation.findFirst({ where: { id: generationA, ownerId: A } })).toBeTruthy();
    // 这一单本身是正常跑完的（不同音频 ⇒ 缓存未命中 ⇒ 真的转写了一次）
    expect((await prisma.captionJob.findFirstOrThrow({ where: { id: jobB2, ownerId: B } })).status).toBe("DONE");
  }, DB_CASE_TIMEOUT_MS);
});
