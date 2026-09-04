/**
 * Home 版面落库、能力闸与租户隔离 —— 打真库(规格 docs/specs/frontend-baseline.md §7.3⑤;
 * 验收 FRONT-A3、FRONT-A4)。
 *
 * 为什么必须打真库:A4 说的是「刷新、换浏览器再登录,布局仍在」。那句话唯一的证明方式是
 * 写进去、换一条读路径再读出来 —— mock 掉 Prisma 只能证明我们**调用了**写,证明不了
 * 写下去的是那一行。A3 的双向租户断言同理:唯一约束、外键、tenant-guard 都在数据库那一侧。
 *
 * 会话与允许名单按 `isolation.test.ts` 同一套 mock:auth() 逐测可控,allowed() 走 env。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  isImpersonating: async () => false,
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const A_EMAIL = `homeA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `homeB-${randomUUID()}@fikirtive.test`;
const MEMBER_EMAIL = `homeMember-${randomUUID()}@fikirtive.test`;

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL},${MEMBER_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone-home@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { canManageHome, readHomeLayout } = await import("@/lib/home-layout-store");
const { saveHomeLayout } = await import("@/lib/home-layout-actions");
const { resolveHomeComponents } = await import("@/lib/home-layout");
const { getProjects } = await import("@/lib/data");

function asUser(email: string) {
  mockAuth.mockResolvedValue({ user: { email } });
}
async function ensureUser(email: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: `usr_${randomUUID()}`, email },
  });
}

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await ensureUser(A_EMAIL);
  await ensureUser(B_EMAIL);
  asUser(A_EMAIL);
  const a = await requireOwner();
  if ("error" in a) throw new Error(a.error);
  orgA = a.ownerId;
  asUser(B_EMAIL);
  const b = await requireOwner();
  if ("error" in b) throw new Error(b.error);
  orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);
});

describe("FRONT-A4:Home 布局服务器持久化", () => {
  it("FRONT-A4:保存后再读是服务器那一行,不是浏览器状态", async () => {
    asUser(A_EMAIL);
    expect(await readHomeLayout(orgA)).toBeNull(); // 从没保存过 → 走推荐模板

    const saved = await saveHomeLayout(["marketing-health"]);
    expect(saved).toEqual({ ok: true });

    // 换一条读路径(直接读库),证明落下去的是那一行而不是内存里的东西。
    const row = await prisma.orgHomeLayout.findUnique({ where: { ownerId: orgA } });
    expect(row?.componentIds).toEqual(["marketing-health"]);
    expect(row?.hiddenIds).toEqual([]);
    expect(row?.updatedById, "落库要记得住是谁改的").toBeTruthy();

    expect(resolveHomeComponents({ goal: "online-sales", saved: await readHomeLayout(orgA) })).toEqual([
      "marketing-health",
    ]);
  });

  it("FRONT-A4:取消勾选也是一次持久化的决定 —— 刷新之后那块仍然不在", async () => {
    asUser(A_EMAIL);
    expect(await saveHomeLayout([])).toEqual({ ok: true });

    const row = await prisma.orgHomeLayout.findUnique({ where: { ownerId: orgA } });
    expect(row?.componentIds).toEqual([]);
    expect(row?.hiddenIds).toEqual(["marketing-health"]);
    expect(resolveHomeComponents({ goal: "online-sales", saved: await readHomeLayout(orgA) })).toEqual([]);
  });

  it("FRONT-A4:一个工作区永远只有一行 —— 第二次保存更新它,不插第二行", async () => {
    asUser(A_EMAIL);
    await saveHomeLayout(["marketing-health"]);
    await saveHomeLayout([]);
    await saveHomeLayout(["marketing-health"]);
    const rows = await prisma.orgHomeLayout.findMany({ where: { ownerId: orgA } });
    expect(rows).toHaveLength(1);
  });

  it("FRONT-A4:客户端发来的未知 id 与面板没列过的 id 存不进库", async () => {
    asUser(A_EMAIL);
    expect(
      await saveHomeLayout(["marketing-health", "recommended-action", "not-a-component", 7, null]),
    ).toEqual({ ok: true });
    const row = await prisma.orgHomeLayout.findUnique({ where: { ownerId: orgA } });
    expect(row?.componentIds).toEqual(["marketing-health"]);
    expect(row?.hiddenIds).toEqual([]);
  });

  it("FRONT-A4:不是数组就拒收,不当成「清空版面」", async () => {
    asUser(A_EMAIL);
    expect(await saveHomeLayout("marketing-health" as unknown)).toEqual({ error: "Bad value." });
    const row = await prisma.orgHomeLayout.findUnique({ where: { ownerId: orgA } });
    expect(row?.componentIds, "拒收之后库里那一行必须没被动过").toEqual(["marketing-health"]);
  });

  it("FRONT-A4:没登录就存不进任何工作区的版面", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await saveHomeLayout(["marketing-health"]);
    expect("error" in result).toBe(true);
  });
});

describe("FRONT-A4:Manage home 判的是能力,不是角色名", () => {
  it("FRONT-A4:工作区 owner 有 workspace.manage_home,入口出现", async () => {
    asUser(A_EMAIL);
    const gate = await requireOwner();
    if ("error" in gate) throw new Error(gate.error);
    expect(await canManageHome(gate)).toBe(true);
  });

  it("FRONT-A4:只有 member/creator 角色的成员没有这条能力,入口不出现,写也写不进去", async () => {
    // A 家新来一个人,角色只有 member 与 creator —— 两个都不带 workspace.manage_home。
    const memberUser = await ensureUser(MEMBER_EMAIL);
    const membership = await prisma.membership.upsert({
      where: { userId_orgId: { userId: memberUser.id, orgId: orgA } },
      update: { status: "active", deletedAt: null },
      create: { id: `mem_${randomUUID()}`, userId: memberUser.id, orgId: orgA, role: "member" },
      select: { id: true },
    });
    for (const role of ["member", "creator"]) {
      await prisma.membershipRole.upsert({
        where: { membershipId_role: { membershipId: membership.id, role } },
        update: {},
        create: { membershipId: membership.id, role },
      });
    }

    asUser(MEMBER_EMAIL);
    const gate = await requireOwner();
    if ("error" in gate) throw new Error(gate.error);
    expect(gate.ownerId, "这个成员解析到的就是 A 家").toBe(orgA);
    expect(await canManageHome(gate)).toBe(false);

    // 入口不出现只是界面上的一半;服务端也必须拒。
    const before = await prisma.orgHomeLayout.findUnique({ where: { ownerId: orgA } });
    expect(await saveHomeLayout([])).toEqual({ error: "You don't have access to this." });
    const after = await prisma.orgHomeLayout.findUnique({ where: { ownerId: orgA } });
    expect(after?.componentIds).toEqual(before?.componentIds);
    expect(after?.hiddenIds).toEqual(before?.hiddenIds);
  });
});

describe("FRONT-A3:两个租户的 Home 各看各的", () => {
  it("FRONT-A3:B 存自己的版面,读到的是自己那一行,不是 A 的", async () => {
    asUser(B_EMAIL);
    expect(await saveHomeLayout([])).toEqual({ ok: true });

    const aRow = await readHomeLayout(orgA);
    const bRow = await readHomeLayout(orgB);
    expect(aRow?.componentIds).toEqual(["marketing-health"]);
    expect(bRow?.componentIds).toEqual([]);
    expect(bRow?.hiddenIds).toEqual(["marketing-health"]);
  });

  it("FRONT-A3:A 改自己的版面,B 那一行一个字节都不动(反向同样成立)", async () => {
    asUser(A_EMAIL);
    await saveHomeLayout([]);
    expect((await readHomeLayout(orgB))?.hiddenIds).toEqual(["marketing-health"]);

    asUser(B_EMAIL);
    await saveHomeLayout(["marketing-health"]);
    expect((await readHomeLayout(orgA))?.componentIds).toEqual([]);
    expect((await readHomeLayout(orgA))?.hiddenIds).toEqual(["marketing-health"]);
    expect((await readHomeLayout(orgB))?.componentIds).toEqual(["marketing-health"]);
  });

  it("FRONT-A3:B 的会话写不进 A 的那一行 —— 租户来自服务端 principal,不是客户端说了算", async () => {
    asUser(B_EMAIL);
    const gate = await requireOwner();
    if ("error" in gate) throw new Error(gate.error);
    expect(gate.ownerId).toBe(orgB); // saveHomeLayout 用的就是这个,客户端没有 ownerId 参数

    // 兜底闸:即便有人绕过动作层直接写库,没有 ownerId 过滤的读写会被 tenant-guard 拦住。
    await expect(
      prisma.orgHomeLayout.findFirst({ where: {} } as never),
    ).rejects.toThrow(/tenant-guard/);
  });

  // 上面三条守的是版面那一行。验收 A3 的正文还点名了 Home 上的第二条读路径:
  // 「Continue creating」的真实画布。HomeEntry 用的是 getProjects(owner.ownerId)
  // (components/home/HomeEntry.tsx 的 readRecentCanvases),ownerId 只来自 requireOwner(),
  // 客户端没有这个参数。这条按 A3 的编号把那条读路径也双向钉住。
  // 剩下的半句(连接状态五态在真实生产者上逐个点亮)属于 §7.3⑤ 第③刀,占位仍在
  // front-baseline-acceptance.test.ts。
  it("FRONT-A3:「Continue creating」列的是自己店的画布 —— 对方的项目双向都不出现", async () => {
    const aProjectId = `prj_${randomUUID()}`;
    const bProjectId = `prj_${randomUUID()}`;
    const aName = `A canvas ${aProjectId}`;
    await prisma.project.create({ data: { id: aProjectId, ownerId: orgA, name: aName } });
    await prisma.project.create({
      data: { id: bProjectId, ownerId: orgB, name: `B canvas ${bProjectId}` },
    });

    const aList = await getProjects(orgA);
    const bList = await getProjects(orgB);
    expect(aList.map((p) => p.id)).toContain(aProjectId);
    expect(aList.map((p) => p.id), "A 的 Home 上出现了 B 的画布").not.toContain(bProjectId);
    expect(bList.map((p) => p.id)).toContain(bProjectId);
    expect(bList.map((p) => p.id), "B 的 Home 上出现了 A 的画布").not.toContain(aProjectId);
    // 验收原话是「对方的数据永不出现」——连名字都不许漏过去。
    expect(JSON.stringify(bList)).not.toContain(aName);
  });
});
