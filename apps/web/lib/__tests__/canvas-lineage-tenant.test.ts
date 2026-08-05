/**
 * 谱系读取的租户边界(#605 T6 · 项目法 Tenant isolation)。
 *
 * 血缘树只画商家自己板上的卡。这里用两个真实 organization 打真库,证明两件事:
 *
 *   ① 商家 A 的板读永远不会带回商家 B 的卡——哪怕 A 的某一行把 B 的卡 id 写进了
 *     `madeFromNodeId`(数据库层面没有跨租户外键拦得住这种写法)。
 *   ② 拿这份板读去建树,树只会说「来源不在这块板上」,既不去别人家里取那张卡,
 *     也不改口说这张是原创。
 *
 * 树本身是纯函数,不碰数据库;它能看见的全部输入就是那份已经按 ownerId 过滤过的板读。
 * 这个测试锁的就是这条链路:唯一入口带 tenant 约束 ⇒ 树无从越界。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

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

const A_EMAIL = `t6OrgA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `t6OrgB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { listCanvasNodes } = await import("@/lib/canvas-actions");
const { buildCanvasLineageTree } = await import("@/lib/canvas-lineage-tree");

async function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA = "", orgB = "";
let aProjectId = "", bProjectId = "";
let aCardId = "", bCardId = "";

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  aProjectId = `prj_${randomUUID()}`;
  bProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: aProjectId, ownerId: orgA, name: "A canvas" } });
  await prisma.project.create({ data: { id: bProjectId, ownerId: orgB, name: "B canvas" } });

  // B's card — the one A must never see, whatever A's own rows claim about it.
  bCardId = `cnd_${randomUUID()}`;
  await prisma.canvasNode.create({
    data: {
      id: bCardId, ownerId: orgB, projectId: bProjectId, type: "image",
      x: 0, y: 0, w: 320, h: 320, prompt: "B's private product shot", status: "done",
      batchIndex: 0, batchSize: 2,
    },
  });

  // A's card records B's card as what it was made from. Nothing in the database stops that
  // string from being written; the read is what has to refuse to follow it.
  aCardId = `cnd_${randomUUID()}`;
  await prisma.canvasNode.create({
    data: {
      id: aCardId, ownerId: orgA, projectId: aProjectId, type: "image",
      x: 0, y: 0, w: 320, h: 320, prompt: "A's own card", status: "done",
      madeFromNodeId: bCardId,
    },
  });
});

describe("商家 A 的谱系读取永远够不到商家 B 的卡", () => {
  it("A 的板读只带回 A 自己的卡", async () => {
    await asUser(A_EMAIL);
    const rows = await listCanvasNodes(aProjectId);
    expect(Array.isArray(rows)).toBe(true);
    const cards = rows as Array<{ id: string; prompt: string | null }>;
    expect(cards.map((card) => card.id)).toEqual([aCardId]);
    expect(JSON.stringify(cards)).not.toContain("B's private product shot");
  });

  it("A 拿 B 的 project id 去读,读到的是拒绝而不是 B 的板", async () => {
    await asUser(A_EMAIL);
    const rows = await listCanvasNodes(bProjectId);
    expect(rows).toEqual({ error: "Project not found." });
  });

  it("树只说来源不在这块板上,不去别人家里取那张卡", async () => {
    await asUser(A_EMAIL);
    const rows = await listCanvasNodes(aProjectId) as Array<{
      id: string; type: string; prompt: string | null; genJobId: string | null;
      batchIndex: number | null; batchSize: number | null; madeFromNodeId: string | null;
    }>;

    const tree = buildCanvasLineageTree(rows, aCardId)!;
    expect(tree.origin).toBe("off-board");
    expect(tree.chain.map((row) => row.id)).toEqual([aCardId]);
    expect(tree.batch).toBeNull();
    expect(JSON.stringify(tree)).not.toContain(bCardId);
  });

  it("B 的板读也只带回 B 自己的卡", async () => {
    await asUser(B_EMAIL);
    const rows = await listCanvasNodes(bProjectId) as Array<{ id: string }>;
    expect(rows.map((card) => card.id)).toEqual([bCardId]);
  });
});
