/** beta bug 4 —— Library 元素的**类型可以改**了(Founder 方案 A)。
 *
 * 录屏抓到的病:一只瓶子被存成了人,`Define the person in <Image_1>` 就这样进了每一次付费
 * 调用,而商家没有任何改正的路 —— 只能删掉元素、连同它的参考照一起丢。
 *
 * 这一份钉五件事,每一件都走真动作、真数据库:
 *   ① 改得成:类型真的落库;
 *   ② 改不歪:四个枚举值之外的字符串一律拒,活行一个字节不动;
 *   ③ 越不过租户:B 拿着 A 的元素 id 调同一个动作,拿到「找不到」,A 的行不动;
 *   ④ 在飞不许把 CHARACTER 改走:worker 那道只对 CHARACTER 生效的定锚闸读的是**活行**
 *      类型,在一单已排队的作业底下抽走它,等于让「没有参考照的角色」滑进一次没有条件图
 *      的付费调用(不改类型的话那一单本会终态失败 + 退款)。
 *   ⑤ 这道闸**没有时间窗口**,方向也只有一个:
 *      · 无窗口 —— 判官在真库证过,任何窗口都短于这条产品线自己的付费时钟链
 *        (供应商轮询 15m < GEN_STALE_MS 18m < 队列过期 20m < 清道夫 25m,
 *        apps/worker/src/jobs/clock-invariants.test.ts 钉死),窗口一开就正好在还会
 *        花钱的那几分钟里放行。释放靠 reaper 不靠时钟,与 deleteVariant 先例一致。
 *      · 单方向 —— 反方向(→ CHARACTER)只是给在飞的那一单**加**一道 fail-closed 退款
 *        闸,不漏钱,所以不拦。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// 与 cross-tenant-write.test.ts 同一套 harness:auth() 逐测可控,allowlist 由 env 驱动。
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
// 写动作都会 revalidatePath,而 vitest 下没有 Next 请求上下文。
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const A_EMAIL = `tOrgA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `tOrgB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { updateEntity } = await import("@/lib/actions");

async function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA: string, orgB: string, aProjectId: string;

async function seedEntity(ownerId: string, name: string, type: "CHARACTER" | "LOCATION" | "PRODUCT" | "BRANDMARK") {
  const id = `ent_${randomUUID()}`;
  await prisma.entity.create({ data: { id, ownerId, name, type } });
  return id;
}

async function typeOf(ownerId: string, entityId: string) {
  const row = await prisma.entity.findFirst({ where: { id: entityId, ownerId }, select: { type: true } });
  return row?.type ?? null;
}

/** 一单提到这个元素的在飞作业。
 *
 *  `updatedAt` 由 Prisma 的 @updatedAt 托管,所以要造一行「N 分钟前的单」必须单独写回。
 *  守卫**不读**这一列(它没有时间窗口)—— 传 `updatedAt` 的那些用例正是为了证明这一点:
 *  年龄再大也照拦。哪天有人重新引入窗口,那几条就会红。 */
async function seedGenJob(ownerId: string, entityId: string, status: "QUEUED" | "GENERATING" | "DONE", updatedAt?: Date) {
  const id = `gj_${randomUUID()}`;
  await prisma.genJob.create({
    data: { id, ownerId, projectId: aProjectId, prompt: "x", model: "seedream", kind: "IMAGE", count: 1, status, entityIds: [entityId] },
  });
  if (updatedAt) await prisma.$executeRaw`UPDATE "GenJob" SET "updatedAt" = ${updatedAt} WHERE "id" = ${id}`;
  return id;
}

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);
  aProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: aProjectId, ownerId: orgA, name: "A project" } });
});

describe("updateEntity — type is correctable (beta bug 4)", () => {
  it("a bottle saved as a person becomes a product, and the change is on the row", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Sambal bottle", "CHARACTER");
    expect(await updateEntity(id, { type: "PRODUCT" })).toEqual({ ok: true });
    expect(await typeOf(orgA, id)).toBe("PRODUCT");
  });

  it("name and type change together in one call", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "wrong", "LOCATION");
    expect(await updateEntity(id, { name: "Signature latte", type: "PRODUCT" })).toEqual({ ok: true });
    const row = await prisma.entity.findFirst({ where: { id, ownerId: orgA }, select: { name: true, type: true } });
    expect(row).toEqual({ name: "Signature latte", type: "PRODUCT" });
  });

  it("the change leaves an audit trail naming both ends", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Kopitiam corner", "CHARACTER");
    await updateEntity(id, { type: "LOCATION" });
    const events = await prisma.actionEvent.findMany({ where: { ownerId: orgA, type: "entity.update" } });
    const mine = events.find((e) => (e.payload as { entityId?: string }).entityId === id);
    expect(mine?.payload).toMatchObject({ typeFrom: "CHARACTER", typeTo: "LOCATION" });
  });

  it("setting the SAME type is a no-op that still succeeds", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    expect(await updateEntity(id, { type: "CHARACTER" })).toEqual({ ok: true });
    expect(await typeOf(orgA, id)).toBe("CHARACTER");
  });
});

describe("updateEntity — only the four enum values get through", () => {
  it.each(["character", "PERSON", "", "PRODUCT; DROP TABLE", "__proto__"])(
    "refuses %j and leaves the row untouched",
    async (bad) => {
      await asUser(A_EMAIL);
      const id = await seedEntity(orgA, "Latte", "PRODUCT");
      expect(await updateEntity(id, { type: bad })).toEqual({ error: "Unknown entity type." });
      expect(await typeOf(orgA, id)).toBe("PRODUCT");
    },
  );

  it("an invalid type refuses the WHOLE call — a valid name beside it is not written either", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Original name", "PRODUCT");
    expect(await updateEntity(id, { name: "New name", type: "person" })).toEqual({ error: "Unknown entity type." });
    const row = await prisma.entity.findFirst({ where: { id, ownerId: orgA }, select: { name: true, type: true } });
    expect(row).toEqual({ name: "Original name", type: "PRODUCT" });
  });
});

describe("updateEntity — the tenant boundary holds for the new field", () => {
  it("org B cannot flip the type of org A's element", async () => {
    const aEntity = await seedEntity(orgA, "A's brand character", "CHARACTER");
    await asUser(B_EMAIL);
    expect(await updateEntity(aEntity, { type: "BRANDMARK" })).toEqual({ error: "Entity not found." });
    expect(await typeOf(orgA, aEntity)).toBe("CHARACTER");
  });

  it("org B's own element still changes — the refusal above is scope, not a dead action", async () => {
    await asUser(B_EMAIL);
    const bEntity = await seedEntity(orgB, "B's bottle", "CHARACTER");
    expect(await updateEntity(bEntity, { type: "PRODUCT" })).toEqual({ ok: true });
    expect(await typeOf(orgB, bEntity)).toBe("PRODUCT");
  });

  it("org A's in-flight job does NOT block org B's own element (the guard is owner-scoped)", async () => {
    await asUser(B_EMAIL);
    // 走**会被拦的那个方向**(CHARACTER → 其它),否则这条根本证明不了 ownerId 收口:
    // 别的方向压根不查作业表,通过了也说明不了什么。
    const bEntity = await seedEntity(orgB, "B's cast member", "CHARACTER");
    // A 的作业提到的是 B 的元素 id —— 现实里不会发生,这里是为了证明闸看的是 ownerId
    // 而不是「世上任何一单提到这个 id 的作业」。
    await seedGenJob(orgA, bEntity, "QUEUED");
    expect(await updateEntity(bEntity, { type: "LOCATION" })).toEqual({ ok: true });
    expect(await typeOf(orgB, bEntity)).toBe("LOCATION");
  });
});

describe("updateEntity — the in-flight guard: CHARACTER 改走要拦(钱路 fail closed)", () => {
  const BUSY = { error: "A generation using this is still running — wait for it to finish, then change the type." };

  it.each(["QUEUED", "GENERATING"] as const)("refuses while a %s generation names this element", async (status) => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    await seedGenJob(orgA, id, status);
    expect(await updateEntity(id, { type: "PRODUCT" })).toEqual(BUSY);
    expect(await typeOf(orgA, id)).toBe("CHARACTER");
  });

  // 判官在真库跑出的反例,原样钉成正式测试。旧实现有一个 15 分钟窗口,而这条产品线自己的
  // 付费时钟链是:供应商轮询 15m < GEN_STALE_MS 18m < 队列过期 20m < 清道夫 25m
  // (apps/worker/src/jobs/clock-invariants.test.ts)。于是第 16–25 分钟这道闸 fail-OPEN:
  // pg-boss 那时仍会送达、worker 仍会读活行类型、钱仍会花。三个取样点各站在链上一档。
  it.each([16, 19, 24])(
    "一单 QUEUED 了 %i 分钟的付费作业**仍然**拦得住 CHARACTER 翻型(旧的 15 分钟窗口在这里 fail-open)",
    async (minutes) => {
      await asUser(A_EMAIL);
      const id = await seedEntity(orgA, "Aisha", "CHARACTER");
      await seedGenJob(orgA, id, "QUEUED", new Date(Date.now() - minutes * 60 * 1000));
      expect(await updateEntity(id, { type: "PRODUCT" })).toEqual(BUSY);
      expect(await typeOf(orgA, id)).toBe("CHARACTER");
    },
  );

  it("没有陈旧窗口:1 小时前的 QUEUED 单同样拦(现实里它早已被清道夫退款清掉)", async () => {
    // 与 deleteVariant 同一条论证:这道闸不认时间,只认「库里还有没有活着的在飞单」。
    // 「岂不是永久锁死」不成立 —— reapStaleGenJobs 对 QUEUED/GENERATING 都在 ~25 分钟
    // (GEN_QUEUED_REAP_MS)加一轮 5 分钟巡检里终态化 + 退款,所以真实世界里根本不存在
    // 一行「1 小时还活着的 QUEUED 单」。这里手工造一行,是为了证明闸本身不靠时钟。
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    await seedGenJob(orgA, id, "QUEUED", new Date(Date.now() - 60 * 60 * 1000));
    expect(await updateEntity(id, { type: "PRODUCT" })).toEqual(BUSY);
    expect(await typeOf(orgA, id)).toBe("CHARACTER");
  });

  it("a FINISHED generation does not block", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    await seedGenJob(orgA, id, "DONE");
    expect(await updateEntity(id, { type: "PRODUCT" })).toEqual({ ok: true });
    expect(await typeOf(orgA, id)).toBe("PRODUCT");
  });

  it("a job that does NOT mention this element does not block it", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    const other = await seedEntity(orgA, "Someone else", "CHARACTER");
    await seedGenJob(orgA, other, "QUEUED");
    expect(await updateEntity(id, { type: "PRODUCT" })).toEqual({ ok: true });
    expect(await typeOf(orgA, id)).toBe("PRODUCT");
  });

  it("the guard is about the TYPE only — a rename still goes through mid-flight", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Typo naem", "CHARACTER");
    await seedGenJob(orgA, id, "QUEUED");
    expect(await updateEntity(id, { name: "Aisha" })).toEqual({ ok: true });
    const row = await prisma.entity.findFirst({ where: { id, ownerId: orgA }, select: { name: true, type: true } });
    expect(row).toEqual({ name: "Aisha", type: "CHARACTER" });
  });

  it("setting the same type mid-flight is not refused — nothing is being taken away", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    await seedGenJob(orgA, id, "QUEUED");
    expect(await updateEntity(id, { type: "CHARACTER" })).toEqual({ ok: true });
  });
});

// 闸只站在**一个方向**上,因为只有那个方向会抽走 worker 的定锚闸。反方向只是给在飞的那
// 一单**加**上一道闸:有参考照 → 什么都没变;没有参考照 → 终态失败 + 退款。两种都不漏钱,
// 所以拦它只会平白挡住商家改正标签。
describe("updateEntity — 只拦 CHARACTER 改走这一个方向", () => {
  it.each(["PRODUCT", "LOCATION", "BRANDMARK"] as const)(
    "%s → CHARACTER 在飞时照样放行(这个方向只会给作业加一道 fail-closed 退款闸)",
    async (from) => {
      await asUser(A_EMAIL);
      const id = await seedEntity(orgA, "Aisha", from);
      await seedGenJob(orgA, id, "QUEUED");
      expect(await updateEntity(id, { type: "CHARACTER" })).toEqual({ ok: true });
      expect(await typeOf(orgA, id)).toBe("CHARACTER");
    },
  );

  it("PRODUCT → LOCATION 在飞时放行 —— 两头都碰不到那道只认 CHARACTER 的闸", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Kopitiam corner", "PRODUCT");
    await seedGenJob(orgA, id, "QUEUED");
    expect(await updateEntity(id, { type: "LOCATION" })).toEqual({ ok: true });
    expect(await typeOf(orgA, id)).toBe("LOCATION");
  });

  it.each(["LOCATION", "PRODUCT", "BRANDMARK"] as const)(
    "CHARACTER → %s 在飞时一律拦(这才是会抽走定锚闸的那个方向)",
    async (to) => {
      await asUser(A_EMAIL);
      const id = await seedEntity(orgA, "Sambal bottle", "CHARACTER");
      await seedGenJob(orgA, id, "QUEUED");
      expect("error" in (await updateEntity(id, { type: to }))).toBe(true);
      expect(await typeOf(orgA, id)).toBe("CHARACTER");
    },
  );
});

afterAll(async () => {
  const both = [orgA, orgB];
  const purge = async (step: (id: string) => Promise<unknown>) => {
    for (const id of both) {
      try { await step(id); } catch { /* best-effort cleanup — never fail the suite here */ }
    }
  };
  await purge((ownerId) => prisma.genJob.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.entity.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.project.deleteMany({ where: { ownerId } }));
  await purge((ownerId) => prisma.actionEvent.deleteMany({ where: { ownerId } }));
  await purge((orgId) => prisma.creditLedger.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.creditAccount.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.membership.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.organization.deleteMany({ where: { id: orgId } }));
  try {
    await prisma.user.deleteMany({ where: { email: { in: [A_EMAIL, B_EMAIL] } } });
  } catch { /* best-effort cleanup */ }
});
