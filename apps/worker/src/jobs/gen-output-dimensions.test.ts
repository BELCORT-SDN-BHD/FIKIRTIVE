/**
 * gen-output-dimensions.test.ts —— 规格 §5 :162①「本站生成的资产写宽高」。
 *
 * ── 它证明什么 ───────────────────────────────────────────────────────────────────
 * 本站生成的资产从前 `Asset.width/height` 恒为 null(ingest 只量 `source: "UPLOAD"`),
 * 于是付费前那道参考图尺寸闸对每一张本站生成的图都读到 `unknown` ⇒ 放行 —— 小图照样进
 * 供应商、照样被建任务前弹回、照样退款。这里跑**真的 `handleGen`**,拿它真正写进
 * `asset.upsert` 的那两格对表:
 *   ① 出图处按真字节量到的宽高真的落库(图片与视频两条路各一次);
 *   ② 量不到(格式认不出、字节是垃圾)⇒ 照旧写 null,交付一格没退 —— 这段代码站在已经
 *      付过钱的字节和商家的交付之间,永远没有否决交付的权力;
 *   ③ 内容寻址撞到同一串字节时,已经量好的那两格不会被一次量不到覆盖成 null;
 *   ④ 量出来的数与 ingest 那把尺子(`probeFile` 的 ffprobe)**逐张相同** —— 同一张图从
 *      上传路和生成路进来,库里那两格必须是同一个数;
 *   ⑤ CREATE-A10 围栏:量尺寸读的是文件头,**一次 sharp 都不跑** —— Founder 2026-09-09 为
 *      「无人像商品照放大」开的是一格,不是一扇门。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const assetUpsert = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateImages = vi.fn();
  const generateVideo = vi.fn();
  const storagePresignedGet = vi.fn();
  const storagePut = vi.fn();
  const storageGet = vi.fn();
  const storage = { presignedGet: storagePresignedGet, put: storagePut, get: storageGet };
  /** 每一次 `sharp(…)` 的入参录音 —— 「量尺寸不借那一格」靠它证明,而不是靠读代码相信。 */
  const sharpInputs: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst, create: generationCreate, updateMany: vi.fn() },
    asset: { upsert: assetUpsert, update: vi.fn() },
    entity: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    entityVariant: { findFirst: vi.fn() },
    referenceImage: { findMany: vi.fn(async () => []) },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, generationFindFirst,
    generationCreate, chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, assetUpsert,
    refundReservation, settleCredits, generateImages, generateVideo, storagePresignedGet,
    storagePut, storageGet, storage, sharpInputs,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: vi.fn(async () => undefined),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));
vi.mock("sharp", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: typeof import("sharp") };
  return {
    default: (input: unknown, ...rest: unknown[]) => {
      m.sharpInputs.push(input);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.default as any)(input, ...rest);
    },
  };
});

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharpReal from "sharp";
import { probeFile } from "./ingest.js";
import { handleGen, measuredOutputSize } from "./gen.js";

const imageJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: null,
  shotId: null,
  status: "QUEUED",
  kind: "IMAGE",
  model: "seedream",
  prompt: "a poster",
  entityIds: [] as string[],
  variantSel: null,
  count: 1,
  videoOptions: null,
  imageOptions: null as { aspectRatio: string } | null,
  generationIds: [] as string[],
  spentUsd: null,
  sourceGenerationId: null as string | null,
  tailGenerationId: null,
  referenceVideoGenerationId: null,
};

/** 一张真的图,真尺寸 —— 断言读的是从字节里量出来的数,不是我们自己抄进去的数。 */
async function imageOf(
  width: number,
  height: number,
  kind: "png" | "jpeg" | "webp" = "png",
): Promise<Buffer> {
  const img = sharpReal({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } });
  return (kind === "png" ? img.png() : kind === "jpeg" ? img.jpeg() : img.webp()).toBuffer();
}
const pngOf = (width: number, height: number) => imageOf(width, height, "png");

/** 三种出图格式各一张,外加一张短边不到 300 的 —— 两条尺寸断言读同一份用例。 */
const CROSS_CHECK_CASES = [
  [1344, 768, "png"],
  [200, 99, "png"],
  [275, 183, "jpeg"],
  [512, 512, "webp"],
] as const;

/** 这台机器上有没有 ffprobe。CI runner 没有(worker 的镜像有),所以交叉核对那条按它跳过。 */
const HAS_FFPROBE = (() => {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeEach(() => {
  vi.clearAllMocks();
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
  m.assetUpsert.mockResolvedValue({ id: "asset1" });
  m.generationCreate.mockResolvedValue({ id: "gen_out1" });
  m.storagePut.mockResolvedValue({ contentHash: "c".repeat(64) });
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
});

/** 真跑一次 handleGen,交回 `asset.upsert` 真正收到的那一份参数。 */
async function upsertArgsFromRealWorker(job: Record<string, unknown>) {
  m.genJobFindUnique.mockResolvedValue(job);
  await handleGen({ genJobId: "g1" }, 0).catch(() => undefined);
  expect(m.assetUpsert, "出图落库必须真的发生过,这条断言才有意义").toHaveBeenCalled();
  return m.assetUpsert.mock.calls[0]![0] as {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
}

describe("规格 §5 :162① —— 本站生成的资产落库时写真宽高", () => {
  it("creation §5 :162①: 出图处按真字节量到的宽高落进 Asset.width/height", async () => {
    m.generateImages.mockResolvedValue([{ bytes: await pngOf(1344, 768), ext: "png" }]);

    const args = await upsertArgsFromRealWorker(imageJob);

    // 数字不是抄进来的:样图是 sharp 铸的,断言的是 ffprobe 从字节里读出来的那一对。
    expect(args.create).toEqual(expect.objectContaining({ width: 1344, height: 768, source: "GENERATED" }));
  });

  it("creation §5 :162①: 短边不到 300 的本站生成图也如实落库(尺寸闸从此看得见它)", async () => {
    m.generateImages.mockResolvedValue([{ bytes: await pngOf(200, 99), ext: "png" }]);

    const args = await upsertArgsFromRealWorker(imageJob);

    expect(args.create).toEqual(expect.objectContaining({ width: 200, height: 99 }));
  });

  /**
   * 「同一套尺子」是**被证明的**,不是被声明的:同一串字节,一边读文件头、一边真的跑
   * ingest 那个 ffprobe(`probeFile`),两边不一致当场红。
   *
   * 为什么不直接在生成路上用 ffprobe:那条路站在已经付过钱的字节和商家的 DONE 之间,多一次
   * 进程外调用就是多一次可能卡住的等待(实证:`gen-last-frame.test.ts` 那条 8 秒预算当场红)。
   */
  it("creation §5 :162①: 三种出图格式(png / jpeg / webp)都量得到,量出来就是它真实的宽高", async () => {
    for (const [w, h, kind] of CROSS_CHECK_CASES) {
      const bytes = await imageOf(w, h, kind);
      // 裁判是 sharp:图是照 w×h 铸出来的,所以「量出来等于 w×h」不是自证。
      expect(measuredOutputSize(bytes), `${w}×${h} ${kind}`).toEqual({ width: w, height: h });
    }
  });

  /**
   * 「同一套尺子」是**被证明的**,不是被声明的:同一串字节,一边读文件头、一边真的跑 ingest
   * 那个 ffprobe(`probeFile`),两边不一致当场红。
   *
   * 装不到 ffprobe 的机器上跳过而不是红:CI runner 没有 ffmpeg(worker 的镜像有,
   * `apps/worker/Dockerfile` 第 5 行 apt 装的),而上面那条无条件的断言已经把「量得对不对」
   * 独立守住了 —— 这一条守的是另一件事:我们的数与 ingest 的数是同一个。
   */
  it.skipIf(!HAS_FFPROBE)(
    "creation §5 :162①: 读文件头量出来的数,与 ingest 那把 ffprobe 尺子逐张相同",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "fikirtive-dim-cross-"));
      try {
        for (const [w, h, kind] of CROSS_CHECK_CASES) {
          const bytes = await imageOf(w, h, kind);
          const file = path.join(dir, `x.${kind}`);
          await writeFile(file, bytes);
          const byProbe = await probeFile(file);
          expect(measuredOutputSize(bytes), `${w}×${h} ${kind}`).toEqual({
            width: byProbe.width,
            height: byProbe.height,
          });
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it("creation §5 :162①: 认不出的格式(视频那条路的 mp4)⇒ null,登记未做而不是猜一个", () => {
    // ftyp/isom 的文件头 —— 一段 mp4 的开头长这样。帧宽高住在 moov 里,今天不解析。
    const mp4Head = Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex");
    expect(measuredOutputSize(mp4Head)).toBeNull();
  });

  it("creation §5 :162①: 量不到(字节读不出尺寸)⇒ 照旧写 null,交付一格没退", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);

    const args = await upsertArgsFromRealWorker(imageJob);

    expect(args.create).not.toHaveProperty("width");
    expect(args.create).not.toHaveProperty("height");
    // 交付照旧发生:量尺寸永远没有否决交付的权力。
    expect(m.generationCreate).toHaveBeenCalledTimes(1);
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
  });

  it("creation §5 :162①: 撞上同一串字节的既有行 —— 量到了才写,量不到一格不碰(不覆盖成 null)", async () => {
    m.generateImages.mockResolvedValue([{ bytes: await pngOf(512, 512), ext: "png" }]);
    const measured = await upsertArgsFromRealWorker(imageJob);
    expect(measured.update).toEqual({ deletedAt: null, width: 512, height: 512 });

    vi.clearAllMocks();
    m.projectFindFirst.mockResolvedValue({ id: "p1" });
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
    m.creditLedgerFindFirst.mockResolvedValue(null);
    m.assetUpsert.mockResolvedValue({ id: "asset1" });
    m.generationCreate.mockResolvedValue({ id: "gen_out1" });
    m.storagePut.mockResolvedValue({ contentHash: "c".repeat(64) });
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([9]), ext: "png" }]);

    const unmeasured = await upsertArgsFromRealWorker(imageJob);
    expect(unmeasured.update).toEqual({ deletedAt: null });
  });

  it("creation §5 :162① / CREATE-A10: 量尺寸只读文件头,一次 sharp 都不跑(开的是一格,不是一扇门)", async () => {
    const bytes = await pngOf(1024, 1024);
    m.sharpInputs.length = 0; // 铸样图那一步自己也走 sharp,录音在样图铸好之后才归零
    m.generateImages.mockResolvedValue([{ bytes, ext: "png" }]);

    const args = await upsertArgsFromRealWorker(imageJob);

    expect(args.create).toEqual(expect.objectContaining({ width: 1024, height: 1024 }));
    // 交付的那串字节一次都没进过图像处理库 —— 像素完整性铁律的最小可测形式。
    expect(m.sharpInputs).toHaveLength(0);
  });
});
