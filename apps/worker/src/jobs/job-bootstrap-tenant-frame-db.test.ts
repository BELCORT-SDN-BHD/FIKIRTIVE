/**
 * job-bootstrap-tenant-frame-db.test.ts — 后台任务**开场那一次读**的租户上下文,打真库、带真守卫。
 *
 * 每个 worker handler 的队列载荷都只带一个 id,所以「这一行属于哪个租户」只能靠开场那次读得知。
 * 这个文件钉的就是那一次读:它必须在具名系统身份(`worker-job-dispatch`)里跑,写入阶段必须
 * 另行进 `runAsTenant`。
 *
 * 为什么必须打真库:`withTenantGuard` 是一个真的 Prisma extension,而这一族缺陷的全部内容
 * 就是「守卫拒了这次读」。`vi.mock("@fikirtive/db")` 的用例连守卫都加载不到 —— ingest 在生产
 * 上每一张商家上传图都失败了整整一段时间,而 worker 的假库用例全绿,原因就在这里。
 *
 * 生产实证(2026-08-14 E2E):`[tenant-guard] Asset.findUnique has no ownerId filter —
 * possible cross-tenant leak`,5 分钟一轮重试,死信堆积,D19 哈希校验从不执行。
 *
 * 三件事钉在这里:
 *  ① 守卫**没有被放宽**:没有身份帧的 `Asset.findUnique` 照旧被拒(修法是给调用点一个具名
 *     系统身份,不是给守卫开口子);
 *  ② 两个租户各自只碰得到自己那一行;
 *  ③ 修好之后任务真的走到守卫之后的业务逻辑(ffprobe/whisper/存储全 mock,一个字节都不出网)。
 */
import { createHash, randomBytes } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

const readStream = vi.hoisted(() => vi.fn());
const ffmpegInput = vi.hoisted(() => vi.fn());
const deleteObject = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../storage.js", () => ({ storage: { readStream, ffmpegInput, deleteObject } }));

/** ffprobe / ffmpeg / whisper-cli 的唯一入口。这里只喂「有画面、没有声音」的探测结果:
 *  ingest 拿它写回宽高,caption 拿它走静音闸 —— 两条路都不需要真的 whisper。 */
const execa = vi.hoisted(() =>
  vi.fn(async () => ({
    stdout: JSON.stringify({
      format: { duration: "0" },
      streams: [{ codec_type: "video", width: 1600, height: 1200 }],
    }),
  })),
);
vi.mock("execa", () => ({ execa }));

import { prisma } from "@fikirtive/db";
import { runAsTenant } from "@fikirtive/db/principal";
import { newId, storageKey, TRANSCRIPT_GENERATION } from "@fikirtive/core";
import { handleIngest } from "./ingest.js";
import { handleCaption } from "./caption.js";
import { handlePublish } from "./publish.js";

// ── 安全闸(同 understand-db.test.ts):非 *_test 库一律拒跑 ──────────────────────
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error(
    "ingest-tenant-db.test.ts hits a real database — set DATABASE_URL to a *_test database before running it.",
  );
}
const dbName = dbUrl.split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`ingest-tenant-db.test.ts refuses a non-*_test database — got "${dbName}".`);
}

const A = `ig-a-${newId()}`;
const B = `ig-b-${newId()}`;

/** 一份「已经躺在对象存储里」的字节。contentHash 是它**真实**的 sha256 —— D19 复核要对得上。 */
function bytes() {
  const buf = randomBytes(64);
  return { buf, hash: createHash("sha256").update(buf).digest("hex") };
}

async function seedAsset(owner: string) {
  const { buf, hash } = bytes();
  const id = newId();
  await prisma.asset.create({
    data: {
      id,
      ownerId: owner,
      contentHash: hash,
      ext: "mp4",
      mime: "video/mp4",
      sizeBytes: BigInt(buf.byteLength),
      originalFilename: "clip.mp4",
      source: "UPLOAD",
    },
  });
  return { id, buf, hash, key: storageKey(owner, hash, "mp4") };
}

/** 测试自己的读也得带 ownerId —— 守卫对这个文件同样有效。 */
async function assetRow(owner: string, id: string) {
  return prisma.asset.findFirst({ where: { id, ownerId: owner } });
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: "ig-tenant-a" } });
  await prisma.organization.create({ data: { id: B, name: "ig-tenant-b" } });
});

afterAll(async () => {
  await prisma.transcript.deleteMany({ where: { ownerId: { in: [A, B] } } });
  await prisma.captionJob.deleteMany({ where: { ownerId: { in: [A, B] } } });
  await prisma.scheduledPost.deleteMany({ where: { ownerId: { in: [A, B] } } });
  // 哈希对不上的那条用例会落一行 asset.hash_mismatch 审计事件
  await prisma.actionEvent.deleteMany({ where: { ownerId: { in: [A, B] } } });
  // #784 的素材理解扫描器是**跨租户**的:同一个库上并行跑的 understand-db.test.ts 调
  // scanAssetsNeedingUnderstanding() 时,会把这个文件刚建的素材也一并认领(建出
  // AssetUnderstanding 行)。那一行的外键 AssetUnderstanding_assetId_ownerId_fkey 会挡住
  // 下面这笔 asset 删除,于是这个文件会随并行调度的变化随机变红 —— 与被测行为无关。
  // 清掉自己名下的认领行,清理顺序才和真实的外键图一致。
  await prisma.assetUnderstanding.deleteMany({ where: { ownerId: { in: [A, B] } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [A, B] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [A, B] } } });
});

beforeEach(() => {
  readStream.mockReset();
  ffmpegInput.mockReset();
  deleteObject.mockReset();
  deleteObject.mockResolvedValue(undefined);
});

describe("守卫仍然严(修的是调用点,不是守卫)", () => {
  it("没有身份帧的 Asset.findUnique 照旧被拒 —— 这正是生产上那句报错", async () => {
    const a = await seedAsset(A);
    await expect(prisma.asset.findUnique({ where: { id: a.id } })).rejects.toThrow(
      /\[tenant-guard\] Asset\.findUnique has no ownerId filter/,
    );
  });

  it("同一条规矩对 ScheduledPost 一样成立(publish 的开场读是同形状)", async () => {
    await expect(prisma.scheduledPost.findUnique({ where: { id: "nope" } })).rejects.toThrow(
      /\[tenant-guard\] ScheduledPost\.findUnique has no ownerId filter/,
    );
  });
});

describe("ingest:队列直接调用(无任何身份帧)必须跑得完", () => {
  it("走完 D19 哈希复核 + ffprobe,把探测结果写回自己那一行", async () => {
    const a = await seedAsset(A);
    readStream.mockResolvedValue([a.buf]);
    ffmpegInput.mockResolvedValue("/tmp/ingest-a.mp4");

    // 生产形状:pg-boss 的 consumer 不带任何身份帧,直接调 handleIngest。
    await handleIngest({ assetId: a.id });

    const row = await assetRow(A, a.id);
    expect(row?.width).toBe(1600);
    expect(row?.height).toBe(1200);
    expect(row?.durationS).toBe(0);
    expect(row?.deletedAt).toBeNull();
    // 读的是自己租户的那把 key(u/<A>/<hash>.mp4),不是别人的
    expect(readStream).toHaveBeenCalledWith(a.key);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("双租户:A 的 ingest 一个字节都不碰 B 的行", async () => {
    const a = await seedAsset(A);
    const b = await seedAsset(B);
    readStream.mockResolvedValue([a.buf]);
    ffmpegInput.mockResolvedValue("/tmp/ingest-a.mp4");

    await handleIngest({ assetId: a.id });

    const rowB = await assetRow(B, b.id);
    expect(rowB?.width).toBeNull();
    expect(rowB?.height).toBeNull();
    expect(rowB?.durationS).toBeNull();
    expect(readStream).not.toHaveBeenCalledWith(b.key);
  });

  it("哈希对不上时仍然按 D19 删掉(证明它真的走到了守卫之后的钱路/安全逻辑)", async () => {
    const a = await seedAsset(A);
    readStream.mockResolvedValue([Buffer.from("these are not the claimed bytes")]);
    ffmpegInput.mockResolvedValue("/tmp/ingest-a.mp4");

    await handleIngest({ assetId: a.id });

    const row = await assetRow(A, a.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(deleteObject).toHaveBeenCalledWith(a.key);
    // 伪造的那份字节从来没被 ffprobe 过
    expect(ffmpegInput).not.toHaveBeenCalled();
  });
});

describe("caption:素材读取被钉在自己租户内", () => {
  async function seedCaptionJob(owner: string, assetId: string, contentHash: string) {
    const id = newId();
    await prisma.captionJob.create({
      data: { id, ownerId: owner, projectId: newId(), assetId, contentHash, status: "QUEUED" },
    });
    return id;
  }

  it("自己的素材:静音闸走完,DONE + 空转录落在自己名下", async () => {
    const a = await seedAsset(A);
    ffmpegInput.mockResolvedValue("/tmp/caption-a.mp4");
    const jobId = await seedCaptionJob(A, a.id, a.hash);

    await handleCaption({ captionJobId: jobId }, 0);

    const job = await prisma.captionJob.findFirst({ where: { id: jobId, ownerId: A } });
    expect(job?.status).toBe("DONE");
    const cached = await prisma.transcript.findFirst({
      where: { ownerId: A, contentHash: a.hash, model: TRANSCRIPT_GENERATION },
    });
    expect(cached?.cuesJson).toEqual([]);
    expect(ffmpegInput).toHaveBeenCalledWith(a.key);
  });

  it("指向别家租户的素材:读回来是空,任务失败,B 的行纹丝不动", async () => {
    const b = await seedAsset(B);
    const { hash } = bytes();
    const jobId = await seedCaptionJob(A, b.id, hash); // A 的任务,B 的素材 id

    await expect(handleCaption({ captionJobId: jobId }, 0)).rejects.toThrow();

    const job = await prisma.captionJob.findFirst({ where: { id: jobId, ownerId: A } });
    expect(job?.status).not.toBe("DONE");
    expect(await assetRow(B, b.id)).toBeTruthy(); // B 的素材还在,没被改过
    expect(ffmpegInput).not.toHaveBeenCalled();
    expect(
      await prisma.transcript.findFirst({ where: { ownerId: B, contentHash: hash } }),
    ).toBeNull();
  });

  it("caption.ts 的那次素材读取本身:租户帧内按 id 读,只读得到自己的", async () => {
    const a = await seedAsset(A);
    const b = await seedAsset(B);
    await runAsTenant(A, async () => {
      expect(await prisma.asset.findUnique({ where: { id: a.id } })).toBeTruthy();
      expect(await prisma.asset.findUnique({ where: { id: b.id } })).toBeNull();
    });
  });
});

describe("publish:同形状的开场读(#738 同族,这次一并收口)", () => {
  it("排期贴的开场读跑得完 —— 已软删的那条安静退出,而不是被守卫打断", async () => {
    const id = newId();
    await prisma.scheduledPost.create({
      data: {
        id,
        ownerId: A,
        projectId: newId(),
        channel: "instagram",
        caption: "hello",
        scheduledAt: new Date(),
        scheduledTz: "Asia/Kuala_Lumpur",
        status: "SCHEDULED",
        source: "owner",
        deletedAt: new Date(),
      },
    });

    // 生产形状:consumer 不带身份帧。修之前这里抛的是守卫那句话,整条排期发布永远发不出去。
    await expect(handlePublish({ scheduledPostId: id }, 0)).resolves.toBeUndefined();

    await prisma.scheduledPost.deleteMany({ where: { id, ownerId: A } });
  });
});
