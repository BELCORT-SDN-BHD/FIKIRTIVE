/** beta bug 4 —— Library 元素的**类型可以改**了(Founder 方案 A)。
 *
 * 录屏抓到的病:一只瓶子被存成了人,`Define the person in <Image_1>` 就这样进了每一次付费
 * 调用,而商家没有任何改正的路 —— 只能删掉元素、连同它的参考照一起丢。
 *
 * 这一份钉四件事,每一件都走真动作、真数据库:
 *   ① 改得成:类型真的落库;
 *   ② 改不歪:四个枚举值之外的字符串一律拒,活行一个字节不动;
 *   ③ 越不过租户:B 拿着 A 的元素 id 调同一个动作,拿到「找不到」,A 的行不动;
 *   ④ 在飞不许改:一单 QUEUED/GENERATING 的 GenJob 提到这个元素时拒绝换类型
 *      —— worker 那道只对 CHARACTER 生效的定锚闸读的是活行类型,在它底下抽走类型
 *      等于让「没有参考照的角色」滑进一次没有条件图的付费调用。过了 15 分钟窗口的
 *      在飞任务按已废弃处理(不然 worker 死一次就等于永久改不回来 —— 正是这张票要修的病)。
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

/** 一单提到这个元素的在飞作业。`updatedAt` 由 @updatedAt 托管,所以「陈旧」要单独写回。 */
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
    const bEntity = await seedEntity(orgB, "B's kopitiam", "PRODUCT");
    // A 的作业提到的是 B 的元素 id —— 现实里不会发生,这里是为了证明闸看的是 ownerId
    // 而不是「世上任何一单提到这个 id 的作业」。
    await seedGenJob(orgA, bEntity, "QUEUED");
    expect(await updateEntity(bEntity, { type: "LOCATION" })).toEqual({ ok: true });
    expect(await typeOf(orgB, bEntity)).toBe("LOCATION");
  });
});

describe("updateEntity — the in-flight guard (money fails closed)", () => {
  const BUSY = { error: "A generation using this is still running — wait for it to finish, then change the type." };

  it.each(["QUEUED", "GENERATING"] as const)("refuses while a %s generation names this element", async (status) => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    await seedGenJob(orgA, id, status);
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

  it("an abandoned job (past the 15-minute window) does not freeze the label forever", async () => {
    await asUser(A_EMAIL);
    const id = await seedEntity(orgA, "Aisha", "CHARACTER");
    await seedGenJob(orgA, id, "QUEUED", new Date(Date.now() - 60 * 60 * 1000));
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
