/**
 * tenant-queue-frames-a8-db.test.ts —— 规格 docs/specs/tenant-isolation.md 验收 **TENANT-A8**
 * （2026-09-15 Founder 裁定随 #1403 同批改写之后的现行文本）：
 * 「跑 8 条队列各一单（caption / gen / ingest / publish / refgen / render / research / understand）
 * ⇒ 8 条全部跑通；帧建立之后该单的所有后续读写都经过值比对（**除已登记豁免表外**；用一次异租户
 * id 注入证明会被拒）。」
 *
 * 在这个文件出现之前，A8 是 `packages/db/src/tenant-isolation-later-slices.test.ts` 里的两条
 * `it.todo`。规格 §4 异议栏点名这一段：worker 的这几条队列是「先读才知道租户」的鸡生蛋结构，
 * 判错就是整批任务当天全挂 —— 所以这里不接受 mock 库上的「调用次数对不对」，只接受真库、真守卫、
 * 真 handler 的行为。
 *
 * ── 这个文件替换掉了什么替身 ────────────────────────────────────────────────────────────────
 * 换掉的只有**出网**的三样，其余全是生产件：
 *   · `execa`  —— ffmpeg / ffprobe / whisper-cli 三个外部二进制（开发机与 CI 都没有）。夹具按
 *     生产的调用形状真的把文件写到 handler 指定的输出路径上，所以 handler 后面那几步（读回
 *     字节、存产出、写终态）跑的是真代码。
 *   · `@fikirtive/otto` 的 `run` —— research 的模型调用（真花钱）。钱路本身（reserve / settle /
 *     refund、账本行）不换，是真的。
 *   · publish 的 `execute`（handler 自带的注入点）—— Meta Graph 外呼。
 * `../storage.js` 不是另写的替身：这里用的是 `LocalDiskStorage` —— 生产工厂 `createStorage()`
 * （`apps/worker/src/storage.ts:9`）在 `STORAGE_DRIVER` 不设时返回的正是这个类
 * （`packages/storage/src/index.ts:946-964`），也就是 dev/CI 每天跑的那一条存储路；这里只把根目录
 * 指向一个临时目录，并在 `put` / `ffmpegInput` / `readStream` 三个入口挂了一个**帧内探针**（见下）。
 * 边界说清楚：staging / production 今天跑的是 `STORAGE_DRIVER=r2`，同一个工厂返回的是 `R2Storage`
 * ——那条存储路本文件不覆盖。
 * 生成引擎更不是替身：`GENERATION_PROVIDER` 不设 + NODE_ENV=test ⇒ 工厂自己解析到离线
 * MockProvider（$0、不出网），这正是 dev/CI 每天跑的那一条；本文件第一条用例把这件事钉住。
 *
 * ── 「帧内注入被拒」怎么证 ───────────────────────────────────────────────────────────────────
 * 关键是：注入必须发生在 **handler 自己那个帧里**，不是测试另开一个帧假装。所以探针挂在
 * handler 在帧内一定会碰的那个边界上：
 *   caption → `storage.ffmpegInput`   ingest → `storage.readStream`   render → `storage.ffmpegInput`
 *   gen / refgen → `storage.put`      publish → 注入的 `execute`      research → `run` 夹具
 * 探针跑在那一刻的 `getPrincipal()` 上，先把帧本身记下来（`{kind:"system",
 * reason:"tenant-direct", ownerId:<本单租户>}` —— `runAsTenant` 在无外层帧时的形状），再对**这条
 * 队列自己那张表**发两笔点名 B 租户的操作（一读一写），把守卫抛出的原话逐字记下来。
 * 两句原话来自 `packages/db/src/tenant-guard.ts` 的值比对分支：
 *   `[tenant-guard] <Model>.<op> tried to use ownerId outside the active tenant`
 *
 * research 那一条点的是 `ChatMessage` 而不是 `ResearchJob`，publish 点的是 `ScheduledPost` 而不是
 * `PublishAttempt`：后两张表在 `TENANT_GUARD_EXEMPT` 名单里（各自带着理由），拿它们当证据是
 * 自欺 —— 要证的是「这一单帧建立之后的读写过值比对」，就得点这条队列真正受守卫的那张表。
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

/** 帧内探针的全部状态 + 两个夹具。`vi.mock` 的工厂只能引用 hoisted 值，所以都放这里。 */
const h = vi.hoisted(() => {
  const dataDir = `${process.env.TMPDIR ?? "/tmp"}/fikirtive-tenant-a8-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let probe: null | (() => Promise<void>) = null;
  return {
    dataDir,
    execa: vi.fn(),
    run: vi.fn(),
    /** 下一次进入存储边界时跑一次，跑完即卸 —— 一单只探一次。 */
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

vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, run: h.run };
});

// #851 的产品级发布闸今天是关的（`PUBLISHING_AVAILABLE === false`），关着时 handlePublish 在任何
// 认领之前就返回 —— 那样 publish 这一条就没有「正常终态」可证。这里把它显式通电，与
// publish-auto-publish-switch.test.ts 同一个做法、同一个理由；闸本身由 publish-preview-gate.test.ts
// 读真实值钉着（闸关时零外呼、零认领）。通电那天，这三行连同注释一起删。
vi.mock("@fikirtive/core/schedule-draft", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, PUBLISHING_AVAILABLE: true };
});

// 生产工厂在 STORAGE_DRIVER 不设时返回的同一个 LocalDiskStorage 类（dev/CI 那条路；生产今天是
// R2Storage），根目录换成临时目录；只在三个入口前插一次帧内探针。
vi.mock("../storage.js", async () => {
  const actual = await vi.importActual<typeof import("@fikirtive/storage")>("@fikirtive/storage");
  const real = new actual.LocalDiskStorage(h.dataDir);
  const put = real.put.bind(real);
  const ffmpegInput = real.ffmpegInput.bind(real);
  const readStream = real.readStream.bind(real);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patched = real as any;
  patched.put = async (...a: Parameters<typeof put>) => {
    await h.fire();
    return put(...a);
  };
  patched.ffmpegInput = async (...a: Parameters<typeof ffmpegInput>) => {
    await h.fire();
    return ffmpegInput(...a);
  };
  patched.readStream = async (...a: Parameters<typeof readStream>) => {
    await h.fire();
    return readStream(...a);
  };
  // understand 这一条队列要一个**能签出 URL** 的存储：`LocalDiskStorage.presignedGet` 永远返回
  // null（本地模式走 /files 路由，packages/storage/src/index.ts:213），而 handler 读到 null 就把行
  // 退回 QUEUED —— 那样这条队列就没有终态可证。生产在 staging/production 跑的是 R2Storage，
  // 它是签得出的，所以这里换成一个固定串，形状与生产一致。这一句不碰帧，也不碰探针。
  patched.presignedGet = async () => "https://storage.example/a8-understand?sig=x";
  return { storage: real };
});

import { prisma, reserveCredits } from "@fikirtive/db";
import { getPrincipal, runAsTenant } from "@fikirtive/db/principal";
import { newId, storageKey, storageKeyToSrc, TRANSCRIPT_GENERATION, DEAD_LETTER_QUEUES } from "@fikirtive/core";
import { createGenerationProvider } from "@fikirtive/generation";
import { provider } from "../generation.js";
import { storage } from "../storage.js";
import { handleCaption } from "./caption.js";
import { handleGen } from "./gen.js";
import { handleIngest } from "./ingest.js";
import { handlePublish, type PublishExecutor } from "./publish.js";
import { handleRefGen } from "./refgen.js";
import { handleRender } from "./render.js";
import { handleResearch } from "./research.js";
import { handleUnderstand } from "./understand.js";

// 同本目录其它真库用例的守卫：绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const A = `a8a-${randomUUID()}`;
const B = `a8b-${randomUUID()}`;
const HOLD = 1_000;
const START = 1_000_000;

/** ffprobe 的回答：有画面、也有声音（caption 因此走完整转写路，不走静音闸）。 */
const PROBE_JSON = JSON.stringify({
  format: { duration: "5" },
  streams: [{ codec_type: "video", width: 1280, height: 720 }, { codec_type: "audio" }],
});

/** whisper-cli -oj 真正写出的形状（毫秒 offsets + 检测到的语言头）。 */
const WHISPER_JSON = JSON.stringify({
  result: { language: "ms" },
  transcription: [{ offsets: { from: 0, to: 480 }, text: " Selamat" }],
});

type FrameProof = { principal: unknown; read: string; write: string };
const proofs: Record<string, FrameProof> = {};

/** 规格 A8 点名的**八**条队列，以及每条「真正受守卫」的那张表 —— ⑨ 的汇总按这张表逐条核。
 *  这张表不是手抄的清单：下面那条汇总用例拿 `@fikirtive/core` 的 `DEAD_LETTER_QUEUES`
 *  做集合相等断言（复审 T4），所以新增一条队列而忘了补这里，汇总当场红。 */
const QUEUE_TABLE: ReadonlyArray<readonly [queue: string, model: string]> = [
  ["ingest", "Asset"],
  ["caption", "CaptionJob"],
  ["gen", "GenJob"],
  ["refgen", "RefGenJob"],
  ["render", "RenderJob"],
  ["publish", "ScheduledPost"],
  ["research", "ChatMessage"],
  // 第八条（#1403，2026-09-15 Founder 裁定「本版修，与翻闸票 #1403 同批」）：素材理解。
  // `packages/core/src/dead-letters.ts` 的 DEAD_LETTER_QUEUES 一直是**八**条，而规格 §2 的 A8 行
  // 只点了七条 —— 规格那一行已随本片改成八条，这里是它的机器侧。
  ["understand", "AssetUnderstanding"],
];

/** 捕捉守卫抛出的**原话**。没抛就是闸没关上 —— 返回一句会让断言当场变红的话。 */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "NO REJECTION —— 异租户注入没有被拒";
}

/** 一条队列的完整签名：帧 + 一读一写两句拒绝原话。 */
function expectFramedAndFenced(queue: string, owner: string, model: string) {
  const proof = proofs[queue];
  expect(proof, `${queue}：探针没有在帧内跑过`).toBeDefined();
  expect(proof!.principal).toMatchObject({ kind: "system", reason: "tenant-direct", ownerId: owner });
  expect(proof!.read).toBe(`[tenant-guard] ${model}.findMany tried to use ownerId outside the active tenant`);
  expect(proof!.write).toBe(`[tenant-guard] ${model}.updateMany tried to use ownerId outside the active tenant`);
}

/** 把一份真字节放进（真的）本地对象存储，返回它的内容哈希与 key。 */
async function putBytes(owner: string, ext: string) {
  const bytes = randomBytes(96);
  const { contentHash } = await storage.put(owner, bytes, ext);
  expect(contentHash).toBe(createHash("sha256").update(bytes).digest("hex"));
  return { bytes, contentHash, key: storageKey(owner, contentHash, ext) };
}

async function seedAsset(owner: string, ext = "mp4") {
  const blob = await putBytes(owner, ext);
  const id = newId();
  await prisma.asset.create({
    data: {
      id,
      ownerId: owner,
      contentHash: blob.contentHash,
      ext,
      mime: ext === "mp4" ? "video/mp4" : "image/png",
      sizeBytes: BigInt(blob.bytes.byteLength),
      originalFilename: `clip.${ext}`,
      source: "UPLOAD",
    },
  });
  return { id, ...blob };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // 付掉连接池 / query engine 的冷启动
  h.execa.mockImplementation(async (bin: string, args: string[]) => {
    if (bin === "ffprobe") return { stdout: PROBE_JSON };
    if (bin === "ffmpeg") {
      // 生产形状：输出路径永远是最后一个参数（caption 的 wav、render 的 out.mp4）。真的写出去，
      // 后面那几步（readFile → storage.put → 终态写）才跑的是真代码。
      const { writeFile } = await import("node:fs/promises");
      await writeFile(String(args[args.length - 1]), randomBytes(64));
      return { stdout: "" };
    }
    if (bin === "whisper-cli") {
      const { writeFile } = await import("node:fs/promises");
      const outBase = String(args[args.indexOf("-of") + 1]);
      await writeFile(`${outBase}.json`, WHISPER_JSON);
      return { stdout: "" };
    }
    return { stdout: "" };
  });
  h.run.mockResolvedValue({
    finalOutput: "# Report\nFindings…",
    newItems: [],
    state: { usage: { inputTokens: 1000, outputTokens: 500 } },
  });

  await prisma.organization.create({ data: { id: A, name: "a8-tenant-a", settings: { autoPublish: true } } });
  await prisma.organization.create({ data: { id: B, name: "a8-tenant-b", settings: { autoPublish: true } } });
  await prisma.creditAccount.create({ data: { orgId: A, balance: START, reserved: 0 } });
  await prisma.creditAccount.create({ data: { orgId: B, balance: START, reserved: 0 } });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  for (const owner of [A, B]) {
    await runAsTenant(owner, async () => {
      await prisma.publishAttempt.deleteMany({ where: { ownerId: owner } });
      await prisma.scheduledPost.deleteMany({ where: { ownerId: owner } });
      await prisma.chatMessage.deleteMany({ where: { ownerId: owner } });
      await prisma.chatThread.deleteMany({ where: { ownerId: owner } });
      await prisma.researchJob.deleteMany({ where: { ownerId: owner } });
      await prisma.captionJob.deleteMany({ where: { ownerId: owner } });
      await prisma.transcript.deleteMany({ where: { ownerId: owner } });
      await prisma.renderJob.deleteMany({ where: { ownerId: owner } });
      await prisma.generation.deleteMany({ where: { ownerId: owner } });
      await prisma.genJob.deleteMany({ where: { ownerId: owner } });
      await prisma.referenceImage.deleteMany({ where: { ownerId: owner } });
      await prisma.refGenJob.deleteMany({ where: { ownerId: owner } });
      await prisma.entityVariant.deleteMany({ where: { ownerId: owner } });
      await prisma.entity.deleteMany({ where: { ownerId: owner } });
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

describe("TENANT-A8 —— 八条队列各一单：跑到终态，且帧内异租户注入被拒（真库、真守卫）", () => {
  it("TENANT-A8 前置：GENERATION_PROVIDER 不设 + 非生产 ⇒ 工厂自己解析到离线 mock（本文件的付费引擎替身就是它）", () => {
    const resolved = createGenerationProvider({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(resolved.name).toBe("mock");
    expect(process.env.GENERATION_PROVIDER).toBeUndefined();
    // 上一行验的是「现搭一个工厂会解析成什么」。真正被 gen / refgen 两条队列调用的，是
    // `../generation.js` 在 import 时解析好的那**一个实例**（apps/worker/src/generation.ts:26）——
    // 要钉的就得是它本人，否则钉住的只是一个测试自己新建、跟 handler 无关的对象。
    expect(provider.name).toBe("mock");
  });

  it("TENANT-A8 ① ingest：一单跑到终态（探针写回自己那一行），帧内点名 B 的 Asset 读写被拒", async () => {
    const asset = await seedAsset(A);
    const otherB = await seedAsset(B);

    h.arm(async () => {
      proofs.ingest = {
        principal: getPrincipal(),
        read: await rejection(() => prisma.asset.findMany({ where: { ownerId: B } })),
        write: await rejection(() =>
          prisma.asset.updateMany({ where: { ownerId: B }, data: { originalFilename: "stolen.mp4" } }),
        ),
      };
    });

    await handleIngest({ assetId: asset.id });

    const row = await prisma.asset.findFirst({ where: { id: asset.id, ownerId: A } });
    expect(row?.width).toBe(1280);
    expect(row?.height).toBe(720);
    expect(row?.durationS).toBe(5);
    expect(row?.deletedAt).toBeNull();
    expectFramedAndFenced("ingest", A, "Asset");
    // 被注入的那一笔写如果漏过去，B 的文件名就会变 —— 它没变。
    expect((await prisma.asset.findFirst({ where: { id: otherB.id, ownerId: B } }))?.originalFilename).toBe("clip.mp4");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ② caption：一单跑到 DONE（转写落进全局缓存），帧内点名 B 的 CaptionJob 读写被拒", async () => {
    const asset = await seedAsset(A);
    const jobId = newId();
    await prisma.captionJob.create({
      data: { id: jobId, ownerId: A, projectId: newId(), assetId: asset.id, contentHash: asset.contentHash, status: "QUEUED" },
    });

    h.arm(async () => {
      proofs.caption = {
        principal: getPrincipal(),
        read: await rejection(() => prisma.captionJob.findMany({ where: { ownerId: B } })),
        write: await rejection(() =>
          prisma.captionJob.updateMany({ where: { ownerId: B }, data: { error: "cross-tenant" } }),
        ),
      };
    });

    await handleCaption({ captionJobId: jobId }, 0);

    const job = await prisma.captionJob.findFirst({ where: { id: jobId, ownerId: A } });
    expect(job?.status).toBe("DONE");
    expect(job?.progress).toBe(100);
    // #1403 之后这张表受守卫，只有**独自**点名缓存键的读才跳过租户比对（规格 §1.6(b)）——
    // 用的就是 caption.ts 自己那把键。
    const cached = await prisma.transcript.findUnique({
      where: { contentHash_model: { contentHash: asset.contentHash, model: TRANSCRIPT_GENERATION } },
    });
    expect(cached?.ownerId).toBe(A);
    expect(cached?.cuesJson).toEqual([{ startMs: 0, lengthMs: 480, text: "Selamat" }]);
    expectFramedAndFenced("caption", A, "CaptionJob");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ③ gen：一单跑到 DONE（产出落库、钱恰好一预扣一结算），帧内点名 B 的 GenJob 读写被拒", async () => {
    const projectId = newId();
    const jobId = newId();
    await prisma.project.create({ data: { id: projectId, ownerId: A, name: "A8 gen" } });
    await prisma.genJob.create({
      data: { id: jobId, ownerId: A, projectId, prompt: "a poster for the weekend sale", kind: "IMAGE", model: "seedream", count: 1, status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: A, refId: jobId, cost: HOLD }));

    h.arm(async () => {
      proofs.gen = {
        principal: getPrincipal(),
        read: await rejection(() => prisma.genJob.findMany({ where: { ownerId: B } })),
        write: await rejection(() => prisma.genJob.updateMany({ where: { ownerId: B }, data: { error: "cross-tenant" } })),
      };
    });

    await handleGen({ genJobId: jobId }, 0);

    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: A } });
    expect(job.status).toBe("DONE");
    expect(job.generationIds).toHaveLength(1);
    const ledger = await prisma.creditLedger.findMany({ where: { orgId: A, refId: jobId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expectFramedAndFenced("gen", A, "GenJob");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ④ refgen：一单跑到 DONE（参考图落库），帧内点名 B 的 RefGenJob 读写被拒", async () => {
    const entityId = newId();
    const jobId = newId();
    await prisma.entity.create({ data: { id: entityId, ownerId: A, type: "PRODUCT", name: "Widget" } });
    await prisma.refGenJob.create({
      data: { id: jobId, ownerId: A, entityId, prompt: "studio shot", count: 1, model: "seedream", mode: "BASE", status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: A, refId: jobId, cost: HOLD }));

    h.arm(async () => {
      proofs.refgen = {
        principal: getPrincipal(),
        read: await rejection(() => prisma.refGenJob.findMany({ where: { ownerId: B } })),
        write: await rejection(() => prisma.refGenJob.updateMany({ where: { ownerId: B }, data: { error: "cross-tenant" } })),
      };
    });

    await handleRefGen({ refGenJobId: jobId }, 0);

    const job = await prisma.refGenJob.findFirstOrThrow({ where: { id: jobId, ownerId: A } });
    expect(job.status).toBe("DONE");
    expect(job.outputAssetIds).toHaveLength(1);
    const ledger = await prisma.creditLedger.findMany({ where: { orgId: A, refId: jobId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expectFramedAndFenced("refgen", A, "RefGenJob");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ⑤ render：一单跑到 DONE（成片存成自己名下的资产），帧内点名 B 的 RenderJob 读写被拒", async () => {
    const clip = await putBytes(A, "mp4");
    const jobId = newId();
    await prisma.renderJob.create({
      data: {
        id: jobId,
        ownerId: A,
        projectId: newId(),
        status: "QUEUED",
        editJson: {
          timeline: {
            background: "#000000",
            tracks: [{ clips: [{ asset: { type: "video", src: storageKeyToSrc(clip.key) }, start: 0, length: 5 }] }],
          },
          output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
        },
      },
    });

    h.arm(async () => {
      proofs.render = {
        principal: getPrincipal(),
        read: await rejection(() => prisma.renderJob.findMany({ where: { ownerId: B } })),
        write: await rejection(() => prisma.renderJob.updateMany({ where: { ownerId: B }, data: { error: "cross-tenant" } })),
      };
    });

    await handleRender({ renderJobId: jobId }, 0);

    const job = await prisma.renderJob.findFirstOrThrow({ where: { id: jobId, ownerId: A } });
    expect(job.status).toBe("DONE");
    expect(job.progress).toBe(100);
    expect(job.outputAssetId).toBeTruthy();
    const out = await prisma.asset.findFirst({ where: { id: job.outputAssetId!, ownerId: A } });
    expect(out?.source).toBe("RENDER");
    expect(out?.width).toBe(1280);
    expect(out?.height).toBe(720);
    expectFramedAndFenced("render", A, "RenderJob");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ⑥ publish：一单跑到 PUBLISHED（认领→外呼→盖章同一条链），帧内点名 B 的 ScheduledPost 读写被拒", async () => {
    const postId = newId();
    await prisma.scheduledPost.create({
      data: {
        id: postId,
        ownerId: A,
        projectId: newId(),
        channel: "instagram",
        metaTargetId: "ig-page-1",
        caption: "Weekend sale",
        scheduledAt: new Date(Date.now() - 60_000),
        scheduledTz: "Asia/Kuala_Lumpur",
        status: "SCHEDULED",
        source: "owner",
        approvedAt: new Date(),
      },
    });

    // 注入的执行器跑在 handler 自己的帧里 —— 探针就挂在这里，零 Meta 外呼。
    const execute: PublishExecutor = async () => {
      proofs.publish = {
        principal: getPrincipal(),
        read: await rejection(() => prisma.scheduledPost.findMany({ where: { ownerId: B } })),
        write: await rejection(() =>
          prisma.scheduledPost.updateMany({ where: { ownerId: B }, data: { lastError: "cross-tenant" } }),
        ),
      };
      return { send: async () => ({ externalId: "ig_media_a8" }) };
    };

    await handlePublish({ scheduledPostId: postId }, 0, execute);

    const post = await prisma.scheduledPost.findFirstOrThrow({ where: { id: postId, ownerId: A } });
    expect(post.status).toBe("PUBLISHED");
    expect(post.metaPostId).toBe("ig_media_a8");
    const attempts = await prisma.publishAttempt.findMany({ where: { scheduledPostId: postId }, select: { state: true, metaPostId: true } });
    expect(attempts).toEqual([{ state: "APPLIED", metaPostId: "ig_media_a8" }]);
    expectFramedAndFenced("publish", A, "ScheduledPost");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ⑦ research：一单跑到 DONE（报告与结算同一笔提交），帧内点名 B 的 ChatMessage 读写被拒", async () => {
    const projectId = newId();
    const threadId = newId();
    const cardId = newId();
    const jobId = newId();
    await prisma.project.create({ data: { id: projectId, ownerId: A, name: "A8 research" } });
    await prisma.chatThread.create({ data: { id: threadId, ownerId: A, projectId } });
    await prisma.chatMessage.create({
      data: {
        id: cardId,
        threadId,
        ownerId: A,
        role: "AGENT",
        kind: "RESEARCH_CARD",
        seq: 1,
        payload: { researchId: "a8", topic: "EV market", tier: "quick", status: "running" },
      },
    });
    await prisma.researchJob.create({
      data: { id: jobId, ownerId: A, threadId, cardId, idempotencyKey: `research:${cardId}`, tier: "quick", status: "QUEUED" },
    });

    // `run` 夹具（模型调用的替身）跑在 handler 自己的帧里。
    h.run.mockImplementationOnce(async () => {
      proofs.research = {
        principal: getPrincipal(),
        read: await rejection(() => prisma.chatMessage.findMany({ where: { ownerId: B } })),
        write: await rejection(() => prisma.chatMessage.updateMany({ where: { ownerId: B }, data: { payload: {} } })),
      };
      return { finalOutput: "# Report\nFindings…", newItems: [], state: { usage: { inputTokens: 1000, outputTokens: 500 } } };
    });

    await handleResearch({ jobId }, 0);

    expect((await prisma.researchJob.findFirstOrThrow({ where: { id: jobId, ownerId: A } })).status).toBe("DONE");
    expect(await prisma.chatMessage.findMany({ where: { ownerId: A, kind: "RESEARCH_REPORT" }, select: { id: true } })).toHaveLength(1);
    const ledger = await prisma.creditLedger.findMany({ where: { orgId: A, refId: `research:${cardId}` }, select: { kind: true }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expectFramedAndFenced("research", A, "ChatMessage");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ⑧ understand：一单跑到 DONE（钱恰好一预扣一结算），帧内点名 B 的 AssetUnderstanding 读写被拒", async () => {
    // 第八条队列（#1403，规格 §5 2026-09-15「understand 补进 TENANT-A8」那一行）。
    // 形状与前七条一字不差：载荷里只有行 id ⇒ `runAsSystem("worker-job-dispatch")` 读一行 ⇒
    // 用行上的 ownerId 建帧（understand.ts:1155 的 `runAsTenant`）⇒ 之后的每一笔读写都过值比对。
    const asset = await seedAsset(A, "jpg");
    // 理解的 pre-flight 闸按**宽高**判（`understandingPreflight`）：宽高为 null ⇒ 「还不知道」⇒
    // 行退回 QUEUED 等 ingest 补元数据。这一单要证的是帧，不是那道闸，所以把元数据补齐。
    await runAsTenant(A, () =>
      prisma.asset.updateMany({ where: { id: asset.id, ownerId: A }, data: { width: 1600, height: 1200 } }),
    );
    const rowId = newId();
    await prisma.assetUnderstanding.create({
      data: {
        id: rowId,
        ownerId: A,
        assetId: asset.id,
        kind: "image-caption",
        status: "QUEUED",
        // 扫描器建行时锁的那格快照价（MONEY-A9）。给上它，这一单就走真钱路：RESERVE → SETTLE。
        priceInternalSnapshot: 1,
      },
    });

    // 探针挂在**注入的供应商端口**上 —— handler 在帧内一定会碰的那个边界（understand.ts 的
    // `port.understand(...)`），所以注入确实发生在 handler 自己那个帧里，不是测试另开一个帧假装。
    const port = {
      name: "mock",
      async understand() {
        proofs.understand = {
          principal: getPrincipal(),
          read: await rejection(() => prisma.assetUnderstanding.findMany({ where: { ownerId: B } })),
          write: await rejection(() =>
            prisma.assetUnderstanding.updateMany({ where: { ownerId: B }, data: { summary: "cross-tenant" } }),
          ),
        };
        return {
          text: JSON.stringify({ summary: "A ceramic mug", category: "homeware", isDocument: false }),
          usage: { inputTokens: 900, outputTokens: 60 },
        };
      },
    };

    await handleUnderstand({ understandingId: rowId }, 0, port as never);

    const row = await runAsTenant(A, () =>
      prisma.assetUnderstanding.findFirstOrThrow({ where: { id: rowId, ownerId: A } }),
    );
    expect(row.status).toBe("DONE");
    expect(row.summary).toBe("A ceramic mug");
    const ledger = await prisma.creditLedger.findMany({
      where: { orgId: A, refId: `understanding:${rowId}` },
      select: { kind: true },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expectFramedAndFenced("understand", A, "AssetUnderstanding");
  }, DB_CASE_TIMEOUT_MS);

  it("TENANT-A8 ⑨ 八条队列的拒绝签名一次摆齐：八个帧全是 tenant-direct + 本单租户，十六笔注入全被同一句话拒掉", (ctx) => {
    // 这一条是 ①–⑧ 的横向汇总：每条队列的现场都由它自己那条用例先断过一次
    // （`expectFramedAndFenced`），这里只是把七份签名并排再看一遍。所以它**不假设**别的用例跑过
    // ——单独跑这一条（`-t` / `--shard` / vitest retry）时 `proofs` 是空的，那不是产品出事，是
    // 没有现场可汇总：显式跳过并写明理由，而不是红一条与产品无关的。
    // 复审 T4（2026-09-19）：队列条数**不手写**。唯一来源是 `packages/core/src/dead-letters.ts` 的
    // `DEAD_LETTER_QUEUES`（每条是 `<queue>.dlq`）—— 集合相等，多一条少一条都红。此前写死的
    // `toHaveLength(8)` 只能挡住「表被删短」，挡不住「系统新增了第九条队列而这张表没跟上」。
    const systemQueues = [...DEAD_LETTER_QUEUES].map((q) => q.replace(/\.dlq$/, ""));
    expect(new Set(QUEUE_TABLE.map(([queue]) => queue))).toEqual(new Set(systemQueues));

    if (Object.keys(proofs).length === 0) {
      ctx.skip("①–⑧ 没有在这次运行里跑过（proofs 为空）——本条只汇总它们留下的现场，自己不产生证据");
      return;
    }
    // 复审 T4：**不再按「谁跑过」裁剪**。只要这一轮跑了任何一条队列，就要求八条现场齐全 ——
    // 否则一条 `it.skip` 或一条静默不产生现场的用例，会让这条汇总照样绿（旧写法就是这样）。
    expect(Object.keys(proofs).length, "①–⑧ 的现场没有齐八份 —— 有队列没跑或没留下证据").toBe(
      QUEUE_TABLE.length,
    );
    expect(Object.keys(proofs).sort()).toEqual(QUEUE_TABLE.map(([queue]) => queue).sort());
    for (const [queue, model] of QUEUE_TABLE) expectFramedAndFenced(queue, A, model);
  });
});
