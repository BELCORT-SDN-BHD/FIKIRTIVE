/**
 * otto-panel-expand-signal.test.ts —— 侧栏面板「本页有进行中的对话就展开」的**真信号**,
 * 对着真库。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14)。
 * 触发:Founder 2026-09-04 追认上一轮的 `?otto=1` 是近似,真信号登记待下一轮 —— 就是这一轮。
 *
 * 为什么必须对真库:这一句是两条查询拼出来的(在途 `GenJob` ∩ `surface='panel'` 的对话),
 * 而两张表之间**没有外键**(`GenJob.threadId` 是一个软引用,见 schema 注释)。全套 mock 的
 * 版本会在 `threadId` 拼错、`surface` 忘了写进 where、`ownerId` 漏在第二条查询上时照样全绿,
 * 而这三种错各自对应一个真实故障:面板永不展开 / 一单画布生成把空面板顶开 / 别家 org 的
 * 生成把这家的面板顶开。
 *
 * 只 mock 掉 `requireOwner`(它要 next-auth 的 session,与本文件要证明的事无关);
 * Prisma 是真的,两个 org 各自的行也是真的。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const requireOwner = vi.fn();
vi.mock("../auth-guard", () => ({ requireOwner: () => requireOwner() }));

const { prisma } = await import("@fikirtive/db");
const { hasPendingPanelThread } = await import("../thread-activity");

const orgA = `org_${randomUUID()}`;
const orgB = `org_${randomUUID()}`;
const projectA = `prj_${randomUUID()}`;
const projectB = `prj_${randomUUID()}`;
const panelThreadA = `ct_${randomUUID()}`;
const canvasThreadA = `ct_${randomUUID()}`;
const legacyThreadA = `ct_${randomUUID()}`;
const panelThreadB = `ct_${randomUUID()}`;

/** 一单在途生成,挂在某条对话上。`status` 默认就是 QUEUED。 */
async function inFlightJob(ownerId: string, projectId: string, threadId: string): Promise<string> {
  const id = `gj_${randomUUID()}`;
  await prisma.genJob.create({
    data: { id, ownerId, projectId, threadId, prompt: "still running", model: "mock-image" },
  });
  return id;
}

beforeAll(async () => {
  for (const id of [orgA, orgB]) await prisma.organization.create({ data: { id, name: id } });
  await prisma.project.create({ data: { id: projectA, ownerId: orgA, name: "A project" } });
  await prisma.project.create({ data: { id: projectB, ownerId: orgB, name: "B project" } });
  await prisma.chatThread.create({
    data: { id: panelThreadA, ownerId: orgA, projectId: projectA, title: "Top up my credits", surface: "panel" },
  });
  await prisma.chatThread.create({
    data: { id: canvasThreadA, ownerId: orgA, projectId: projectA, title: "Male model image", surface: "canvas" },
  });
  // 这条规则之前写的每一行都长这样:列在,但没有人写过它。
  await prisma.chatThread.create({
    data: { id: legacyThreadA, ownerId: orgA, projectId: projectA, title: "Legacy" },
  });
  await prisma.chatThread.create({
    data: { id: panelThreadB, ownerId: orgB, projectId: projectB, title: "B panel thread", surface: "panel" },
  });
});

afterAll(async () => {
  await prisma.genJob.deleteMany({ where: { ownerId: { in: [orgA, orgB] } } });
  await prisma.chatThread.deleteMany({ where: { ownerId: { in: [orgA, orgB] } } });
  await prisma.project.deleteMany({ where: { ownerId: { in: [orgA, orgB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

beforeEach(async () => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue({ ownerId: orgA, email: "a@b.c" });
  await prisma.genJob.deleteMany({ where: { ownerId: { in: [orgA, orgB] } } });
});

describe("FRONT-A14 侧栏 Otto 展开信号(真库)", () => {
  it("FRONT-A14 — 面板对话上有进行中的 GenJob 时展开", async () => {
    await inFlightJob(orgA, projectA, panelThreadA);

    expect(await hasPendingPanelThread()).toEqual({ pending: true });
  });

  it("FRONT-A14 — 没有进行中的 GenJob 就不展开", async () => {
    expect(await hasPendingPanelThread()).toEqual({ pending: false });
  });

  it("FRONT-A14 — 已经结束的 GenJob 不算进行中", async () => {
    const done = await inFlightJob(orgA, projectA, panelThreadA);
    // `updateMany` + ownerId:租户闸(`packages/db/src/tenant-guard.ts`)不收没有 ownerId
    // 过滤的写,测试也不例外 —— 这正是它该有的样子。
    await prisma.genJob.updateMany({ where: { id: done, ownerId: orgA }, data: { status: "DONE" } });

    expect(await hasPendingPanelThread()).toEqual({ pending: false });
  });

  it("FRONT-A14 — 别家 org 的进行中不算(双租户)", async () => {
    await inFlightJob(orgB, projectB, panelThreadB);

    // A 看不见 B 的在途生成……
    expect(await hasPendingPanelThread()).toEqual({ pending: false });
    // ……B 自己看得见,证明上一句不是「这条查询根本查不出东西」。
    requireOwner.mockResolvedValue({ ownerId: orgB, email: "b@b.c" });
    expect(await hasPendingPanelThread()).toEqual({ pending: true });
  });

  it("FRONT-A14 — 画布对话与来路不明的老行在跑,面板不展开(它本来也不会续这两种)", async () => {
    await inFlightJob(orgA, projectA, canvasThreadA);
    await inFlightJob(orgA, projectA, legacyThreadA);

    expect(await hasPendingPanelThread()).toEqual({ pending: false });
  });

  it("FRONT-A14 — 删掉的面板对话在跑也不展开", async () => {
    await inFlightJob(orgA, projectA, panelThreadA);
    await prisma.chatThread.updateMany({ where: { id: panelThreadA, ownerId: orgA }, data: { deletedAt: new Date() } });

    expect(await hasPendingPanelThread()).toEqual({ pending: false });

    await prisma.chatThread.updateMany({ where: { id: panelThreadA, ownerId: orgA }, data: { deletedAt: null } });
  });

  it("FRONT-A14 — 没登录时是错误,不是「没有活动对话」", async () => {
    requireOwner.mockResolvedValue({ error: "Not authorized." });

    expect(await hasPendingPanelThread()).toEqual({ error: "Not authorized." });
  });
});
