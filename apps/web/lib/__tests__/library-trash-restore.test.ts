/**
 * library-trash-restore —— 删除是**可撤销**的,而且商家有一扇门能看见回收站
 * (清单 B3 / P1-007;前端基线规格 `docs/specs/frontend-baseline.md` §5 2026-09-05 行;
 *  验收行 FRONT-A5 / FRONT-A14)。
 *
 * 病象:数据层历来就是软删(`lib/actions.deleteGeneration` 写 `deletedAt`),而详情面的
 * 确认框写着 "This cannot be undone." —— 一句关于我们自己的假话。假话的根因不是措辞,
 * 是商家侧确实**没有**回收站与恢复入口:一件东西删掉之后就再也找不回来,尽管行还躺在库里。
 *
 * 这份文件钉的就是那扇门的三件事:
 *   ① 删掉的行进回收站(`getGenerationHistory({ trashed: true })`),同时从正常列表消失;
 *   ② `restoreGeneration` 把它拿回来,再列一次两边都对得上;
 *   ③ **恢复是租户内的** —— 另一个商家拿着我的 id 调恢复,得到的是 "Not found.",
 *      而我的那一行仍在回收站里没被动过。
 *
 * 顺带钉血缘节的两条:成本折的是**账本**已经记下的净扣费(不是现算),另一个租户读不到
 * 我的血缘。
 *
 * 硬口径:真数据库、真 Prisma、真 `requireOwner`、真存储字节。只有会话被 mock ——
 * 要证的正是「身份只来自服务端 principal」,所以身份那一处必须能换人,别的都不许假。
 *
 * 变异自查(逐一实做,做完还原,红→绿):
 *   · 把 `getGenerationHistory` 的 `trashed` 分支改回恒 `deletedAt: null` ⇒ ①红;
 *   · 把 `restoreGeneration` 的 `where` 去掉 `ownerId` ⇒ ③红;
 *   · 把 `getGenerationLineage` 的成本改成读 `GenJob.spentUsd` 换算 ⇒ 成本那一条红。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  isImpersonating: vi.fn(async () => false),
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin: () => false, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireOwner } = await import("@/lib/auth-guard");
const { getGenerationHistory } = await import("@/lib/library-actions");
const { deleteGeneration, restoreGeneration, getGenerationLineage } = await import("@/lib/actions");
const { storage } = await import("@/lib/storage");
const { prisma } = await import("@fikirtive/db");
const { newId } = await import("@fikirtive/core");

const REPO_ROOT = path.join(process.cwd(), "..", "..");

const EMAIL_A = `trash-a-${randomUUID()}@fikirtive.test`;
const EMAIL_B = `trash-b-${randomUUID()}@fikirtive.test`;
let ownerA: string;
let ownerB: string;
let projectA: string;
let genA: string;
let paidGenA: string;

/** 让下一次 `requireOwner()` 以这个人的身份跑。真守卫、真引导。 */
async function signInAs(email: string): Promise<string> {
  mockAuth.mockResolvedValue({ user: { email } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

async function seedGeneration(
  ownerId: string,
  projectId: string,
  label: string,
): Promise<string> {
  // 存储是内容寻址的 —— 字节各不相同,否则两个 org 会共用同一个 hash。
  const bytes = new TextEncoder().encode(`fikirtive-trash-${ownerId}-${label}`);
  const { contentHash } = await storage.put(ownerId, bytes, "png");
  const asset = await prisma.asset.upsert({
    where: { ownerId_contentHash: { ownerId, contentHash } },
    update: {},
    create: {
      id: newId(),
      ownerId,
      contentHash,
      ext: "png",
      mime: "image/png",
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: "",
      source: "RENDER",
      width: 8,
      height: 10,
    },
  });
  const generation = await prisma.generation.create({
    data: {
      id: newId(),
      ownerId,
      projectId,
      assetId: asset.id,
      source: "RENDER",
      promptText: label,
      entitySnapshot: { entities: [{ id: "ent_1", type: "PRODUCT", name: "Pandan kaya jar" }] },
    },
  });
  return generation.id;
}

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = `${EMAIL_A},${EMAIL_B}`;
  for (const email of [EMAIL_A, EMAIL_B]) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `usr_${randomUUID()}`, email },
    });
  }
  ownerA = await signInAs(EMAIL_A);
  ownerB = await signInAs(EMAIL_B);

  const a = await prisma.project.create({ data: { id: newId(), ownerId: ownerA, name: "Hari Raya gifting" } });
  projectA = a.id;
  genA = await seedGeneration(ownerA, projectA, "a storefront at dusk");
  paidGenA = await seedGeneration(ownerA, projectA, "a kaya jar on rattan");

  // 一单真的付过费的任务:血缘节的成本那一格折的就是它的**账本行**(RESERVE + SETTLE),
  // 不是 GenJob 上那个内部成本快照。
  const jobId = newId();
  await prisma.genJob.create({
    data: {
      id: jobId,
      ownerId: ownerA,
      projectId: projectA,
      prompt: "a kaya jar on rattan",
      model: "test-image",
      kind: "IMAGE",
      status: "DONE",
      generationIds: [paidGenA],
    },
  });
  await prisma.creditAccount.upsert({
    where: { orgId: ownerA },
    update: {},
    create: { orgId: ownerA, balance: 100_000, reserved: 0 },
  });
  // 一笔完整的两条腿:先 hold 800 内部 credits,再结掉。净扣费 = 800 内部 = 80 显示 credits
  // (1 显示 credit = 10 内部,`packages/core/src/spend.ts` 的 INTERNAL_PER_DISPLAY)。
  await prisma.creditLedger.createMany({
    data: [
      {
        id: newId(), orgId: ownerA, balanceDelta: -800, reservedDelta: 800,
        kind: "RESERVE", refId: jobId, idempotencyKey: `reserve:${jobId}`,
      },
      {
        id: newId(), orgId: ownerA, balanceDelta: 0, reservedDelta: -800,
        kind: "SETTLE", refId: jobId, idempotencyKey: `settle:${jobId}`,
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  for (const ownerId of [ownerA, ownerB]) {
    if (!ownerId) continue;
    rmSync(path.join(REPO_ROOT, ".data", "storage", "u", ownerId), { recursive: true, force: true });
  }
});

describe("FRONT-A5 删除 = 移进回收站,而不是「无法撤销」", () => {
  it("删掉的那一件离开正常列表,出现在回收站里 —— 两边同一个读模型,一个开关", async () => {
    await signInAs(EMAIL_A);
    const before = await getGenerationHistory({ take: 100 });
    if ("error" in before) throw new Error(before.error);
    expect(before.items.map((item) => item.id)).toContain(genA);

    const deleted = await deleteGeneration(genA);
    expect(deleted).toEqual({ ok: true });

    const live = await getGenerationHistory({ take: 100 });
    if ("error" in live) throw new Error(live.error);
    expect(live.items.map((item) => item.id), "删掉的东西还留在正常列表里").not.toContain(genA);

    const trash = await getGenerationHistory({ take: 100, trashed: true });
    if ("error" in trash) throw new Error(trash.error);
    expect(trash.items.map((item) => item.id), "删掉的东西在回收站里找不到 = 商家真的拿不回来").toContain(genA);
    // 回收站是回收站,不是「全部」:还活着的那一件不该混进来。
    expect(trash.items.map((item) => item.id)).not.toContain(paidGenA);
  });

  it("FRONT-A5 恢复把它拿回来 —— 正常列表有了,回收站空了", async () => {
    await signInAs(EMAIL_A);
    const restored = await restoreGeneration(genA);
    expect(restored).toEqual({ ok: true });

    const live = await getGenerationHistory({ take: 100 });
    if ("error" in live) throw new Error(live.error);
    expect(live.items.map((item) => item.id)).toContain(genA);

    const trash = await getGenerationHistory({ take: 100, trashed: true });
    if ("error" in trash) throw new Error(trash.error);
    expect(trash.items.map((item) => item.id)).not.toContain(genA);
  });

  it("对着一件没在回收站里的素材再按一次 —— 说不行,不是一次静默的成功", async () => {
    await signInAs(EMAIL_A);
    expect(await restoreGeneration(genA)).toEqual({ error: "Not found." });
  });

  it("收藏那一路接不住回收站 ⇒ 当场说不行,不悄悄返回一页活着的收藏", async () => {
    await signInAs(EMAIL_A);
    const result = await getGenerationHistory({ favoriteOnly: true, trashed: true });
    expect("error" in result && result.error).toContain("trashed");
  });
});

describe("FRONT-A5 回收站与恢复都是租户内的", () => {
  it("另一个商家拿着我的 id 调恢复 —— Not found.,我的那一行原地不动", async () => {
    await signInAs(EMAIL_A);
    expect(await deleteGeneration(genA)).toEqual({ ok: true });

    await signInAs(EMAIL_B);
    expect(await restoreGeneration(genA), "跨租户恢复成功了").toEqual({ error: "Not found." });
    const foreignTrash = await getGenerationHistory({ take: 100, trashed: true });
    if ("error" in foreignTrash) throw new Error(foreignTrash.error);
    expect(foreignTrash.items.map((item) => item.id), "另一个商家的回收站里出现了我的东西").not.toContain(genA);

    await signInAs(EMAIL_A);
    const mine = await getGenerationHistory({ take: 100, trashed: true });
    if ("error" in mine) throw new Error(mine.error);
    expect(mine.items.map((item) => item.id), "跨租户那一下把我的行改掉了").toContain(genA);
    // 收拾干净,免得后面的用例读到一件躺在回收站里的素材。
    expect(await restoreGeneration(genA)).toEqual({ ok: true });
  });
});

describe("FRONT-A14 血缘节:出处、参考、成本、状态、用途都读已经记下来的列", () => {
  it("成本折的是**账本**已经记下的净扣费,不是现算的价", async () => {
    await signInAs(EMAIL_A);
    const record = await getGenerationLineage(paidGenA);
    if ("error" in record) throw new Error(record.error);
    // RESERVE -800 + SETTLE 0 ⇒ 净 800 内部 credits ⇒ 80 显示 credits。
    expect(record.costCredits).toBe(80);
    expect(record.status).toBe("Delivered");
    expect(record.canvas).toEqual({ id: projectA, name: "Hari Raya gifting" });
    // 参考读的是生成那一刻冻结的元素名快照 —— 改名不破历史。
    expect(record.references).toEqual(["Pandan kaya jar"]);
    // 还没被挂到分镜或战役上 ⇒ 什么都不说,不写一句 "None"。
    expect(record.usedIn).toEqual([]);
  });

  it("没有引擎任务的那一行 = 没花过钱,成本是 0 而不是「未知」", async () => {
    await signInAs(EMAIL_A);
    const record = await getGenerationLineage(genA);
    if ("error" in record) throw new Error(record.error);
    expect(record.costCredits).toBe(0);
  });

  it("另一个商家读不到我的血缘 —— Not found.,不是一份删干净的空记录", async () => {
    await signInAs(EMAIL_B);
    expect(await getGenerationLineage(paidGenA)).toEqual({ error: "Not found." });
  });
});
