import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/auth-guard", async () => ({ requireOwner: vi.fn(), resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    chatThread: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
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

import { createProject, deleteProject, getOrCreateDefaultProject, setProjectPinned } from "@/lib/actions";
import { requireOwner } from "@/lib/auth-guard";
import { prisma } from "@fikirtive/db";
import { refundReservation } from "@fikirtive/db";
import { revalidatePath } from "next/cache";

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
    (prisma.project.create as Mock).mockResolvedValue({ id: "p_new", name: "New project" });

    await expect(getOrCreateDefaultProject()).resolves.toEqual({ id: "p_new" });

    // #546 F-18: no more pre-seeded "My Videos" — a fresh org's bootstrap project is
    // the standard "New project" placeholder, which auto-titles from the first
    // conversation and is reused by the rail's New-project entry while still empty.
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New project" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_new",
        type: "project.create",
        payload: { name: "New project", via: "bootstrap" },
      }),
    }));
    expect(revalidatePath).not.toHaveBeenCalled();
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
        error: "Cancelled by project deletion",
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
        name: { in: ["New project", "New campaign", "Untitled Project"] },
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
        name: { in: ["New project", "New campaign", "Untitled Project"] },
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
