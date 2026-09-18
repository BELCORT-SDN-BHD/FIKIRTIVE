/**
 * R3-F25 —— **画布拖放上传当场进理解队列**(Founder 2026-09-18 裁「这个设计完全不合理,可以移除」)。
 *
 * 缺陷的形状:`uploadReference`(画布拖放的那条入口)落完 Asset + Generation 就回话了,从来
 * 没有把 ingest 派出去。ingest 才是写 `Asset.width/height` 的那一步,而素材理解的扫描器只捞
 * 元数据齐的行(`METADATA_READY_FOR_UNDERSTANDING`,apps/worker/src/jobs/understand.ts)。
 * 于是这条路上传的素材要等兜底的 `redispatchLostIngest` —— **15 分钟到 24 小时** ——
 * 才可能被理解、才可能扣那 0.1 credit、才可能出 #1464 那一行回执。那一段窗口里商家看到的是
 * "No charge"。**那不是免费,是延后。**
 *
 * 这个文件跑真库,钉三件事:
 *   ① 上传当场就派出一条 ingest,**恰好一条**,带的就是刚落的那个 asset id;
 *   ② 派工之后那件素材**不再落在补投扫描器的候选集里** —— 没有人还在等那 15 分钟;
 *   ③ 同一份字节传两次仍旧只有**一个** Asset,而理解行的幂等键 `(ownerId, assetId, kind)`
 *      因此只容得下一行 —— 一笔钱,不是两笔(MONEY-A9 / #1464 同一条口径)。
 *
 * 红→绿:改动前 ① 是 0 条派工、② 那件素材正躺在候选集里(这正是商家等 15 分钟的原因)。
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

const A_EMAIL = `f25-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = A_EMAIL;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { runAsTenant } = await import("@fikirtive/db/principal");
const { uploadReference } = await import("@/lib/actions");
const { newId } = await import("@fikirtive/core");

/** 一张真的 1x1 PNG:签名 + IHDR + 零长 IDAT,于是字节推导出来的 mime 就是 image/png。 */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00,
]);

/** 给字节加盐,让每个用例有自己的 content hash(Asset 按 owner+hash 去重)。 */
function pngFile(name: string, salt: string): File {
  const bytes = new Uint8Array([...PNG, ...new TextEncoder().encode(salt)]);
  return new File([bytes as unknown as BlobPart], name, { type: "image/png" });
}

function dropOnCanvas(file: File): FormData {
  const fd = new FormData();
  fd.append("files", file);
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
  await prisma.project.create({ data: { id: projectId, ownerId: orgA, name: "F25 canvas" } });
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

describe("R3-F25 · 画布拖放上传当场进理解队列", () => {
  it("上传当场派出恰好一条 ingest,带的就是刚落的那件素材", async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue("job-id");

    const res = await uploadReference(projectId, dropOnCanvas(pngFile("drop.png", `now-${randomUUID()}`)));
    expect(res).toMatchObject({ id: expect.any(String) });

    const gen = await prisma.generation.findFirst({
      where: { ownerId: orgA, id: (res as { id: string }).id },
      select: { assetId: true },
    });
    expect(gen?.assetId).toEqual(expect.any(String));

    // 恰好一条,队列名与载荷都对上 —— 改动前这里是 0 条,商家要等补投窗。
    expect(mockSend.mock.calls).toEqual([[INGEST_QUEUE, { assetId: gen!.assetId }]]);
  });

  it("派工之后那件素材不再躺在补投扫描器的候选集里 —— 没有人还在等那 15 分钟", async () => {
    mockSend.mockReset();
    // 这个替身站在 worker 的 `handleIngest` 的位置上:它做的就是那条活对库的**唯一**可见后果 ——
    // 把 ffprobe 读出来的宽高写回 Asset。真探针由 apps/worker 的 ingest 用例钉着,这里钉的是
    // 「派了这条活之后,补投扫描器还剩什么可捞」。
    mockSend.mockImplementation(async (_queue: string, payload: { assetId: string }) => {
      await runAsTenant(orgA, async () =>
        prisma.asset.update({ where: { id: payload.assetId }, data: { width: 1, height: 1 } }),
      );
      return "job-id";
    });

    const res = await uploadReference(projectId, dropOnCanvas(pngFile("drop.png", `sweep-${randomUUID()}`)));
    const gen = await prisma.generation.findFirst({
      where: { ownerId: orgA, id: (res as { id: string }).id },
      select: { assetId: true },
    });

    // 改动前:一条都没派 ⇒ 宽高仍旧全空 ⇒ 这一行正躺在候选集里等 15 分钟。
    expect(await sweeperCandidateIds(orgA)).not.toContain(gen!.assetId);
  });

  it("同一份字节拖两次:一个 Asset、两张卡,理解行的幂等键只容得下一行 ⇒ 一笔钱", async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue("job-id");

    const salt = `twice-${randomUUID()}`;
    const first = await uploadReference(projectId, dropOnCanvas(pngFile("same.png", salt)));
    const second = await uploadReference(projectId, dropOnCanvas(pngFile("same.png", salt)));
    expect(first).toMatchObject({ id: expect.any(String) });
    expect(second).toMatchObject({ id: expect.any(String) });

    const gens = await prisma.generation.findMany({
      where: { ownerId: orgA, id: { in: [(first as { id: string }).id, (second as { id: string }).id] } },
      select: { id: true, assetId: true },
    });
    expect(gens).toHaveLength(2); // 两张卡
    const assetIds = [...new Set(gens.map((g) => g.assetId))];
    expect(assetIds).toHaveLength(1); // 一件素材(内容寻址,按 owner+contentHash 去重)

    // 两次上传各派一条 ingest,带的是**同一个** asset id:ingest 本身幂等(重算的哈希与探针
    // 值一模一样),所以重复派工不产生第二件东西。
    expect(mockSend.mock.calls).toEqual([
      [INGEST_QUEUE, { assetId: assetIds[0] }],
      [INGEST_QUEUE, { assetId: assetIds[0] }],
    ]);

    // 钱:理解按 `(ownerId, assetId, kind)` 唯一。一件素材的一种理解只有一行,于是只有一个
    // `understanding:<行 id>` refId,也就只有一个 `reserve:<refId>` 幂等键 —— 一笔预扣、
    // 一笔结算。第二行在库层就被拒(P2002),不是靠应用层记得住。
    await runAsTenant(orgA, async () => {
      await prisma.assetUnderstanding.create({
        data: { id: newId(), ownerId: orgA, assetId: assetIds[0]!, kind: "image-caption" },
      });
      await expect(
        prisma.assetUnderstanding.create({
          data: { id: newId(), ownerId: orgA, assetId: assetIds[0]!, kind: "image-caption" },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });
    expect(
      await prisma.assetUnderstanding.count({ where: { ownerId: orgA, assetId: assetIds[0]!, kind: "image-caption" } }),
    ).toBe(1);
  });
});
