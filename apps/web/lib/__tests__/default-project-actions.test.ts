import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/auth-guard", async () => ({ requireOwner: vi.fn(), resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    chatThread: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    chatMessage: { deleteMany: vi.fn() },
    researchJob: { findFirst: vi.fn(), deleteMany: vi.fn() },
    shot: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    shotEntityRef: { deleteMany: vi.fn() },
    scheduledPost: { count: vi.fn(), deleteMany: vi.fn() },
    canvasNode: { count: vi.fn(), deleteMany: vi.fn() },
    renderJob: { deleteMany: vi.fn() },
    captionJob: { deleteMany: vi.fn() },
    generationBatch: { deleteMany: vi.fn() },
    genJob: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    generation: { count: vi.fn(), deleteMany: vi.fn() },
    actionEvent: { create: vi.fn(), deleteMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  refundReservation: vi.fn(),
}));

import {
  autoTitleProjectIfDefault,
  createProject,
  deleteProject,
  getOrCreateDefaultProject,
  setProjectPinned,
} from "@/lib/actions";
import { requireOwner } from "@/lib/auth-guard";
import { prisma } from "@fikirtive/db";
import { refundReservation } from "@fikirtive/db";
import { revalidatePath } from "next/cache";
import { BRAND_MEMORY_STARTERS, FRONT_DOOR_GOAL_LABELS } from "@/lib/otto-canned-starters";

beforeEach(() => {
  vi.clearAllMocks();
  (requireOwner as Mock).mockResolvedValue({ ownerId: "o1", email: "owner@example.test" });
  (prisma.project.findMany as Mock).mockResolvedValue([]);
  (prisma.chatThread.count as Mock).mockResolvedValue(0);
  (prisma.shot.count as Mock).mockResolvedValue(0);
  (prisma.scheduledPost.count as Mock).mockResolvedValue(0);
  (prisma.canvasNode.count as Mock).mockResolvedValue(0);
  (prisma.genJob.count as Mock).mockResolvedValue(0);
  (prisma.generation.count as Mock).mockResolvedValue(0);
  (prisma.genJob.findMany as Mock).mockResolvedValue([]);
  (prisma.genJob.updateMany as Mock).mockResolvedValue({ count: 1 });
  (prisma.researchJob.findFirst as Mock).mockResolvedValue(null);
  (prisma.project.deleteMany as Mock).mockResolvedValue({ count: 1 });
  (prisma.project.updateMany as Mock).mockResolvedValue({ count: 1 });
  (prisma.chatThread.findMany as Mock).mockResolvedValue([]);
  (prisma.shot.findMany as Mock).mockResolvedValue([]);
  (prisma.chatThread.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.chatMessage.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.researchJob.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.shot.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.shotEntityRef.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.scheduledPost.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.canvasNode.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.renderJob.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.captionJob.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.generationBatch.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.genJob.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.generation.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.actionEvent.deleteMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.$executeRaw as Mock).mockResolvedValue(undefined);
  (refundReservation as Mock).mockResolvedValue({ ok: true });
  (prisma.chatThread.findFirst as Mock).mockResolvedValue(null);
  (prisma.chatThread.findMany as Mock).mockResolvedValue([]);
  (prisma.project.update as Mock).mockResolvedValue({ id: "p1" });
  (prisma.$transaction as Mock).mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
});

describe("getOrCreateDefaultProject", () => {
  it("returns the oldest existing project without mutating", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p_existing" });

    await expect(getOrCreateDefaultProject()).resolves.toEqual({ id: "p_existing" });

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates the first project without render-time revalidation", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue(null);
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "New canvas" });

    await expect(getOrCreateDefaultProject()).resolves.toEqual({ id: "p_new" });

    // #546 F-18: no more pre-seeded "My Videos" — a fresh org's bootstrap project is
    // the standard canvas-vocabulary placeholder (Codex QA-CRE-006 — "Canvas, not
    // Project", `docs/specs/frontend-baseline.md` §5), which auto-titles from the first
    // conversation and is reused by the rail's New-canvas entry while still empty.
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New canvas" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_new",
        type: "project.create",
        payload: { name: "New canvas", via: "bootstrap" },
      }),
    }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// #677 (#546 收口余项) — auto-naming had no direct pin. The only test that exercised the
// journey (otto-new-conversation-routing.test.ts) MOCKS autoTitleProjectIfDefault away, so a
// merchant's first project could silently stay "New project" forever, or worse pick up the
// literal word "Untitled", without anything going red. These call the real action.
describe("autoTitleProjectIfDefault — a new project takes its name from the first conversation", () => {
  const DEFAULTS = ["New project", "New campaign", "Untitled Project"] as const;

  it.each(DEFAULTS)("renames a still-default %s to the first conversation's title", async (placeholder) => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: placeholder });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: "Ramadan bundle launch" }]);

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true, name: "Ramadan bundle launch" });

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { name: "Ramadan bundle launch" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p1",
        type: "project.autotitle",
        payload: { name: "Ramadan bundle launch" },
      }),
    }));
  });

  it("adopts the OLDEST conversation's title, not the newest", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: "First one" }, { title: "Later one" }]);

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true, name: "First one" });

    expect(prisma.chatThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: "o1", projectId: "p1" }),
      orderBy: { createdAt: "asc" },
    }));
  });

  it("truncates an over-long conversation title to 80 chars", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: "B".repeat(120) }]);

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true, name: "B".repeat(80) });
  });

  it("never copies the literal Untitled onto a project", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: "Untitled" }]);

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true });
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  // #979(beta 录像 01:28)—— 画布叫「Let me describe my brand to you — ask me what you need
  // to know.」。那不是商家写的字,是 Brand memory 起手 chip 里我们自己的文案。建对话那一侧
  // 已经不会再把它写成标题,但**已经叫这个名字的旧对话行还在库里**,而画布是从对话标题抄
  // 名字的 —— 少了这一条,那些画布会继续被我们的文案命名。
  it.each(BRAND_MEMORY_STARTERS.map((c) => [c.label, c.prompt] as const))(
    "never copies our own starter chip「%s」onto a canvas",
    async (_label, prompt) => {
      (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
      (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: prompt.trim() }]);

      await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true });
      expect(prisma.project.update).not.toHaveBeenCalled();
    },
  );

  it.each(Object.values(FRONT_DOOR_GOAL_LABELS))(
    "never copies our own front-door goal label「%s」onto a canvas",
    async (label) => {
      (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
      (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: label }]);

      await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true });
      expect(prisma.project.update).not.toHaveBeenCalled();
    },
  );

  // 判官第二枪:只读最早一条对话,罐头那条改叫 Untitled 之后就永远命中早退 ——
  // 画布**再也不会**被命名,而注释还写着「之后会被真正的内容命名」。那是一句假话。
  // 现在往后找第一条可采用的对话,所以商家真打的第一条消息最终会命名这块画布。
  it("skips our own copy and adopts the merchant's first real conversation", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([
      { title: BRAND_MEMORY_STARTERS[0]!.prompt },   // 罐头 chip(最早)
      { title: "Untitled" },                          // 前门建的空对话
      { title: "Sell a product" },                    // 我们的目标格子标签
      { title: "Raya hamper photos" },                // ← 商家自己的第一条
      { title: "Later idea" },
    ]);

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true, name: "Raya hamper photos" });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { name: "Raya hamper photos" },
    });
  });

  it("still adopts the EARLIEST adoptable one, not the newest", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([
      { title: "Untitled" },
      { title: "First real one" },
      { title: "Second real one" },
    ]);

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true, name: "First real one" });
  });

  it("reads conversations oldest-first and bounded", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: "Raya hamper photos" }]);

    await autoTitleProjectIfDefault("p1");

    expect(prisma.chatThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "asc" },
      take: expect.any(Number),
    }));
  });

  it("never copies a project placeholder name across either", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: "New campaign" }]);

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true });
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("waits when there is no conversation yet, or its title is blank", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "New project" });

    (prisma.chatThread.findMany as Mock).mockResolvedValue([]);
    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true });

    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ title: "   " }]);
    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true });

    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("is idempotent: a project the merchant already named is left alone", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "Ramadan bundle launch" });

    await expect(autoTitleProjectIfDefault("p1")).resolves.toEqual({ ok: true });

    expect(prisma.chatThread.findMany).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("owner-scoped and fail-closed: another tenant's project is not found and not touched", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue(null);

    await expect(autoTitleProjectIfDefault("p_other")).resolves.toEqual({ error: "Project not found." });

    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "p_other", ownerId: "o1", deletedAt: null }),
    }));
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

describe("deleteProject", () => {
  it("returns not found without mutating when the project is not owned/live", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue(null);

    await expect(deleteProject("p_missing")).resolves.toEqual({ error: "Project not found." });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.project.deleteMany).not.toHaveBeenCalled();
  });

  it("hard-deletes project-scoped records and the project in one transaction", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "Summer launch" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    (prisma.shot.findMany as Mock).mockResolvedValue([{ id: "s1" }]);

    await expect(deleteProject("p1")).resolves.toEqual({ ok: true });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
    expect(prisma.researchJob.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", threadId: { in: ["t1", "t2"] } } });
    expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", threadId: { in: ["t1", "t2"] } } });
    expect(prisma.chatThread.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", id: { in: ["t1", "t2"] } } });
    expect(prisma.canvasNode.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.renderJob.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.captionJob.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.scheduledPost.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.generationBatch.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.genJob.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.generation.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.shotEntityRef.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", shotId: { in: ["s1"] } } });
    expect(prisma.shot.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.actionEvent.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p1" } });
    expect(prisma.project.deleteMany).toHaveBeenCalledWith({ where: { id: "p1", ownerId: "o1" } });
    expect(prisma.project.updateMany).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: null,
        type: "project.delete",
        payload: { projectId: "p1", name: "Summer launch", hardDelete: true },
      }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refunds queued generation reservations before hard-deleting the project", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "Summer launch" });
    (prisma.genJob.findMany as Mock).mockResolvedValue([{ id: "g-queued", status: "QUEUED" }]);

    await expect(deleteProject("p1")).resolves.toEqual({ ok: true });

    expect(prisma.genJob.updateMany).toHaveBeenCalledWith({
      where: { id: "g-queued", ownerId: "o1", status: "QUEUED" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "Canceled by project deletion",
        finishedAt: expect.any(Date),
      }),
    });
    expect(refundReservation).toHaveBeenCalledWith(prisma, { orgId: "o1", refId: "g-queued" });
    expect(prisma.project.deleteMany).toHaveBeenCalledWith({ where: { id: "p1", ownerId: "o1" } });
  });

  it("blocks hard delete while a generation is already running", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "Summer launch" });
    (prisma.genJob.findMany as Mock).mockResolvedValue([{ id: "g-live", status: "GENERATING" }]);

    await expect(deleteProject("p1")).resolves.toEqual({
      error: "A generation is still running in this project. Delete it after the generation finishes.",
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
    expect(prisma.project.deleteMany).not.toHaveBeenCalled();
  });

  it("blocks hard delete while research is still running in a conversation", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1", name: "Summer launch" });
    (prisma.chatThread.findMany as Mock).mockResolvedValue([{ id: "t1" }]);
    (prisma.researchJob.findFirst as Mock).mockResolvedValue({ id: "r-live" });

    await expect(deleteProject("p1")).resolves.toEqual({
      error: "Research is still running in this project. Delete it after research finishes.",
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.chatMessage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.project.deleteMany).not.toHaveBeenCalled();
  });
});

describe("setProjectPinned", () => {
  it("pins through an owner-scoped write", async () => {
    (prisma.project.findFirst as Mock).mockResolvedValue({ id: "p1" });

    await expect(setProjectPinned("p1", true)).resolves.toEqual({ ok: true, pinnedAt: expect.any(String) });

    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", ownerId: "o1" },
      data: { pinnedAt: expect.any(Date) },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerId: "o1", projectId: "p1", type: "project.pin" }),
    }));
  });
});

describe("createProject", () => {
  it("returns auth errors without throwing so expired sessions can recover in the UI", async () => {
    (requireOwner as Mock).mockResolvedValue({ error: "Not authorized." });

    await expect(createProject("New project")).resolves.toEqual({ error: "Not authorized." });

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates an owner-scoped project and revalidates after success", async () => {
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "New project" });

    await expect(createProject("New project")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New project" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_new",
        type: "project.create",
        payload: { name: "New project" },
      }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reuses an empty default project instead of creating duplicate sidebar rows", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: "p_empty", name: "New project", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);

    await expect(createProject("New project")).resolves.toEqual({ id: "p_empty" });

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: {
        ownerId: "o1",
        // Codex QA-CRE-006: the recognized-placeholder list now comes from the single
        // source in `canvas-title.ts` — every legacy name plus today's "New canvas".
        name: { in: ["New project", "New campaign", "Untitled Project", "My First Project", "New canvas"] },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, editJson: true, coworkBrief: true, brandId: true, campaignId: true },
      take: 12,
    });
    expect(prisma.chatThread.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.shot.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.scheduledPost.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.canvasNode.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty" } });
    expect(prisma.genJob.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty" } });
    expect(prisma.generation.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.project.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reuses an empty legacy 'New campaign' row for the canonical 'New project' request", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: "p_legacy", name: "New campaign", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);

    await expect(createProject("New project")).resolves.toEqual({ id: "p_legacy" });

    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerId: "o1",
        name: { in: ["New project", "New campaign", "Untitled Project", "My First Project", "New canvas"] },
        deletedAt: null,
      },
      select: { id: true, name: true, editJson: true, coworkBrief: true, brandId: true, campaignId: true },
    }));
    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: "p_legacy", ownerId: "o1", name: "New campaign", deletedAt: null },
      data: { name: "New project" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_legacy",
        type: "project.rename",
        payload: { name: "New project" },
      }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("does not rename the bootstrap project when the blank canvas entry reuses it", async () => {
    // The northstar home's "New canvas" button calls createProject("") ⇒ cleanName
    // "Untitled Project". Reuse is matched across every placeholder name, so it lands on
    // the same empty bootstrap row — but only a "New project" request canonicalizes the
    // name, so the merchant's sidebar row must not flip to "Untitled Project".
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: "p_bootstrap", name: "New project", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);

    await expect(createProject("")).resolves.toEqual({ id: "p_bootstrap" });

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.project.updateMany).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("fails closed if the legacy row changes before its canonical rename", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: "p_legacy", name: "New campaign", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);
    (prisma.project.updateMany as Mock).mockResolvedValue({ count: 0 });

    await expect(createProject("New project")).resolves.toEqual({ error: "Project not found." });

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates a new default project when the existing default project has work", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: "p_used", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);
    (prisma.canvasNode.count as Mock).mockResolvedValue(1);
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "New project" });

    await expect(createProject("New project")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New project" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_new",
        type: "project.create",
        payload: { name: "New project" },
      }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("creates a new default project when the existing default project has storyboard shots", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: "p_storyboard", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);
    (prisma.shot.count as Mock).mockResolvedValue(1);
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "New project" });

    await expect(createProject("New project")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New project" },
    });
  });

  it("creates a new default project when the existing default project has scheduled posts", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([{ id: "p_schedule", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);
    (prisma.scheduledPost.count as Mock).mockResolvedValue(1);
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "New project" });

    await expect(createProject("New project")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New project" },
    });
  });

  it("creates a new default project when the existing default project has project-level work", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([
      { id: "p_brief", editJson: null, coworkBrief: "Use neon product closeups", brandId: null, campaignId: null },
      { id: "p_edit", editJson: { timeline: { clips: [] } }, coworkBrief: null, brandId: null, campaignId: null },
    ]);
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "New project" });

    await expect(createProject("New project")).resolves.toEqual({ id: "p_new" });

    expect(prisma.chatThread.count).not.toHaveBeenCalled();
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New project" },
    });
  });

  it("does not reuse projects for explicit custom names", async () => {
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_custom", name: "Summer launch" });

    await expect(createProject("Summer launch")).resolves.toEqual({ id: "p_custom" });

    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "Summer launch" },
    });
  });

  it("treats an explicit 'Untitled' Project name as custom instead of reusing an existing Project", async () => {
    (prisma.project.findMany as Mock).mockResolvedValue([
      { id: "p_existing", editJson: null, coworkBrief: null, brandId: null, campaignId: null },
    ]);
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "Untitled" });

    await expect(createProject("Untitled")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "Untitled" },
    });
  });
});
