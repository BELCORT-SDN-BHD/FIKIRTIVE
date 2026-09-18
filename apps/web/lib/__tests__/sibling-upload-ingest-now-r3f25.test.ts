/**
 * R3-F25 的**同根两处**——Library「新建元素」的参考图与素材详情的裁剪保存,同样当场进理解队列。
 *
 * Founder 2026-09-18 裁「这个设计完全不合理,可以移除」针对的是**那一类**设计,不是画布
 * 那一条入口:`createEntity`(`lib/actions.ts`)与 `saveCroppedGeneration`
 * (`lib/asset-actions.ts`)落的是同样会被自动理解、同样会按 MONEY-A9 扣那 0.1 credit 的
 * `source: "UPLOAD"` 素材,却同样一次 ingest 都没派过。按家规「修根不修表、关类不补例」,
 * 它们随同一票一起改成当场入队,这个文件是它们的行为证据(真库)。
 *
 * 每一条钉两件事,与画布那一份(`canvas-upload-ingest-now-r3f25.test.ts`)同一个口径:
 *   ① 落行之后当场派出**恰好一条** ingest,载荷就是刚落的那个 asset id;
 *   ② 那条活跑完之后,这件素材**不再落在补投扫描器的候选集里** —— 没有人还在等那 15 分钟。
 *
 * 红→绿:改动前两条都是 0 条派工,两件素材都正躺在候选集里。
 *
 * 补投扫描器**自己**的选行条件由 `apps/worker/src/jobs/ingest-redispatch.test.ts` 钉着;
 * 这里查的是「那个条件此刻捞不捞得到这一行」的库状态,不是它的第二份实现。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INGEST_QUEUE } from "@fikirtive/core";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

// 与其余双租户真库套件同一个会话/白名单接缝。
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: mockSend })) }));

const A_EMAIL = `f25sib-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = A_EMAIL;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { runAsTenant } = await import("@fikirtive/db/principal");
const { createEntity } = await import("@/lib/actions");
const { saveCroppedGeneration } = await import("@/lib/asset-actions");
const { storage } = await import("@/lib/storage");
const { newId, storageKey } = await import("@fikirtive/core");

/** 一张真的 1x1 PNG:签名 + IHDR + 零长 IDAT,于是字节推导出来的 mime 就是 image/png。 */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00,
]);

/** 给字节加盐,让每个用例有自己的 content hash(Asset 按 owner+hash 去重)。 */
function saltedPng(salt: string): Uint8Array {
  return new Uint8Array([...PNG, ...new TextEncoder().encode(salt)]);
}

function pngFile(name: string, salt: string): File {
  return new File([saltedPng(salt) as unknown as BlobPart], name, { type: "image/png" });
}

/** Library「新建元素」那张表单:名字、类型、参考图。 */
function newElementForm(name: string, files: File[]): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("type", "CHARACTER"); // 产品那一支另走 createProduct,不是这一票要证的事
  for (const f of files) fd.append("files", f);
  return fd;
}

/** 补投扫描器此刻捞得到的候选集(`redispatchLostIngest` 的 where,窗口条件除外)。
 *  窗口只决定「多久之后捞」,不决定「捞不捞得到」—— 这里问的是后者。 */
async function sweeperCandidateIds(ownerId: string): Promise<string[]> {
  const rows = await prisma.asset.findMany({
    where: { ownerId, deletedAt: null, source: "UPLOAD", width: null, height: null, durationS: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** 这个替身站在 worker 的 `handleIngest` 的位置上:它做的就是那条活对库的**唯一**可见后果 ——
 *  把 ffprobe 读出来的宽高写回 Asset。真探针由 apps/worker 的 ingest 用例钉着。 */
function sendThatProbes(ownerId: string) {
  return async (_queue: string, payload: { assetId: string }) => {
    await runAsTenant(ownerId, async () =>
      prisma.asset.update({ where: { id: payload.assetId }, data: { width: 1, height: 1 } }),
    );
    return "job-id";
  };
}

let orgA: string;
let projectId: string;

beforeAll(async () => {
  await prisma.user.upsert({
    where: { email: A_EMAIL },
    update: {},
    create: { id: `usr_${randomUUID()}`, email: A_EMAIL },
  });
  mockAuth.mockResolvedValue({ user: { email: A_EMAIL } });
  const a = await requireOwner();
  if ("error" in a) throw new Error(a.error);
  orgA = a.ownerId;
  projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId: orgA, name: "F25 siblings" } });
});

afterAll(async () => {
  if (!orgA) return;
  await prisma.assetUnderstanding.deleteMany({ where: { ownerId: orgA } });
  // Generation / ReferenceImage → Asset 都是 FK Restrict,引用行先走
  // (新 org 自带一批预置角色素材 —— `actor-library-seed`)
  await prisma.generation.deleteMany({ where: { ownerId: orgA } });
  await prisma.referenceImage.deleteMany({ where: { ownerId: orgA } });
  await prisma.entity.updateMany({ where: { ownerId: orgA }, data: { baseAssetId: null } });
  await prisma.entity.deleteMany({ where: { ownerId: orgA } });
  await prisma.asset.deleteMany({ where: { ownerId: orgA } });
  await prisma.project.deleteMany({ where: { ownerId: orgA } });
  await prisma.actionEvent.deleteMany({ where: { ownerId: orgA } });
});

describe("R3-F25 同根① · Library「新建元素」的参考图当场进理解队列", () => {
  it("建一件元素、挂一张参考图:当场派出恰好一条 ingest,带的就是刚落的那件素材", async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue("job-id");

    const salt = `entity-${randomUUID()}`;
    const res = await createEntity(newElementForm(`Hero ${salt}`, [pngFile("ref.png", salt)]));
    expect(res).toMatchObject({ id: expect.any(String) });

    const ref = await prisma.referenceImage.findFirst({
      where: { ownerId: orgA, entityId: (res as { id: string }).id },
      select: { assetId: true },
    });
    expect(ref?.assetId).toEqual(expect.any(String));

    // 恰好一条 —— 改动前这里是 0 条,商家要等 15 分钟到 24 小时的补投窗。
    expect(mockSend.mock.calls).toEqual([[INGEST_QUEUE, { assetId: ref!.assetId }]]);
  });

  it("两张参考图 = 两条 ingest,各带各的 asset id(一次失败不拖垮另一张)", async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue("job-id");

    const salt = `entity2-${randomUUID()}`;
    const res = await createEntity(
      newElementForm(`Duo ${salt}`, [pngFile("a.png", `${salt}-a`), pngFile("b.png", `${salt}-b`)]),
    );
    expect(res).toMatchObject({ id: expect.any(String) });

    const refs = await prisma.referenceImage.findMany({
      where: { ownerId: orgA, entityId: (res as { id: string }).id },
      orderBy: { position: "asc" },
      select: { assetId: true },
    });
    expect(refs).toHaveLength(2);
    expect(mockSend.mock.calls).toEqual(refs.map((r) => [INGEST_QUEUE, { assetId: r.assetId }]));
  });

  it("派工之后那张参考图不再躺在补投扫描器的候选集里 —— 没有人还在等那 15 分钟", async () => {
    mockSend.mockReset();
    mockSend.mockImplementation(sendThatProbes(orgA));

    const salt = `entity3-${randomUUID()}`;
    const res = await createEntity(newElementForm(`Swept ${salt}`, [pngFile("ref.png", salt)]));
    const ref = await prisma.referenceImage.findFirst({
      where: { ownerId: orgA, entityId: (res as { id: string }).id },
      select: { assetId: true },
    });

    expect(await sweeperCandidateIds(orgA)).not.toContain(ref!.assetId);
  });
});

describe("R3-F25 同根② · 素材详情的裁剪保存当场进理解队列", () => {
  /** 裁剪要有一件**源**素材。它自己是 GENERATED(宽高已知),不会混进补投候选集,
   *  所以下面那条断言查的确实是裁剪出来的那一件。 */
  async function seedGeneratedSource(salt: string): Promise<string> {
    const bytes = saltedPng(`source-${salt}`);
    const { contentHash } = await storage.put(orgA, bytes, "png");
    return runAsTenant(orgA, async () => {
      const asset = await prisma.asset.create({
        data: {
          id: newId(), ownerId: orgA, contentHash, ext: "png", mime: "image/png",
          sizeBytes: BigInt(bytes.byteLength), originalFilename: "source.png",
          source: "GENERATED", width: 1, height: 1,
        },
      });
      // 用一下 storageKey,证明这件源素材落在它该在的键上(与 storage.put 同一条坐标)。
      expect(storageKey(orgA, contentHash, "png")).toContain(contentHash);
      const gen = await prisma.generation.create({
        data: {
          id: newId(), ownerId: orgA, projectId, shotId: null, assetId: asset.id,
          source: "GENERATED", promptText: "a hero", entitySnapshot: { entities: [] },
        },
      });
      return gen.id;
    });
  }

  function croppedDataUrl(salt: string): string {
    return `data:image/png;base64,${Buffer.from(saltedPng(`crop-${salt}`)).toString("base64")}`;
  }

  it("裁剪保存落一件新素材:当场派出恰好一条 ingest,带的就是那件新素材", async () => {
    const salt = `crop-${randomUUID()}`;
    const sourceId = await seedGeneratedSource(salt);

    mockSend.mockReset();
    mockSend.mockResolvedValue("job-id");

    const res = await saveCroppedGeneration(sourceId, croppedDataUrl(salt));
    expect(res).toMatchObject({ id: expect.any(String) });

    const gen = await prisma.generation.findFirst({
      where: { ownerId: orgA, id: (res as { id: string }).id },
      select: { assetId: true },
    });
    expect(gen?.assetId).toEqual(expect.any(String));

    // 恰好一条 —— 改动前这里是 0 条。
    expect(mockSend.mock.calls).toEqual([[INGEST_QUEUE, { assetId: gen!.assetId }]]);
  });

  it("派工之后那件裁剪素材不再躺在补投扫描器的候选集里", async () => {
    const salt = `crop2-${randomUUID()}`;
    const sourceId = await seedGeneratedSource(salt);

    mockSend.mockReset();
    mockSend.mockImplementation(sendThatProbes(orgA));

    const res = await saveCroppedGeneration(sourceId, croppedDataUrl(salt));
    const gen = await prisma.generation.findFirst({
      where: { ownerId: orgA, id: (res as { id: string }).id },
      select: { assetId: true },
    });

    expect(await sweeperCandidateIds(orgA)).not.toContain(gen!.assetId);
  });
});
