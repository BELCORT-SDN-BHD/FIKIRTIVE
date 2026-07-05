import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guard", () => ({ requireOwner: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    chatThread: { count: vi.fn() },
    shot: { count: vi.fn() },
    scheduledPost: { count: vi.fn() },
    canvasNode: { count: vi.fn() },
    genJob: { count: vi.fn() },
    generation: { count: vi.fn() },
    actionEvent: { create: vi.fn() },
  },
}));

import { createProject, getOrCreateDefaultProject } from "@/lib/actions";
import { requireOwner } from "@/lib/auth-guard";
import { prisma } from "@fikirtive/db";
import { revalidatePath } from "next/cache";

beforeEach(() => {
  vi.clearAllMocks();
  (requireOwner as any).mockResolvedValue({ ownerId: "o1", email: "owner@example.test" });
  (prisma.project.findMany as any).mockResolvedValue([]);
  (prisma.chatThread.count as any).mockResolvedValue(0);
  (prisma.shot.count as any).mockResolvedValue(0);
  (prisma.scheduledPost.count as any).mockResolvedValue(0);
  (prisma.canvasNode.count as any).mockResolvedValue(0);
  (prisma.genJob.count as any).mockResolvedValue(0);
  (prisma.generation.count as any).mockResolvedValue(0);
});

describe("getOrCreateDefaultProject", () => {
  it("returns the oldest existing project without mutating", async () => {
    (prisma.project.findFirst as any).mockResolvedValue({ id: "p_existing" });

    await expect(getOrCreateDefaultProject()).resolves.toEqual({ id: "p_existing" });

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates the first project without render-time revalidation", async () => {
    (prisma.project.findFirst as any).mockResolvedValue(null);
    (prisma.project.create as any).mockResolvedValue({ id: "p_new", name: "My Videos" });

    await expect(getOrCreateDefaultProject()).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "My Videos" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_new",
        type: "project.create",
        payload: { name: "My Videos", via: "simple-mode" },
      }),
    }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createProject", () => {
  it("returns auth errors without throwing so expired sessions can recover in the UI", async () => {
    (requireOwner as any).mockResolvedValue({ error: "Not authorized." });

    await expect(createProject("New campaign")).resolves.toEqual({ error: "Not authorized." });

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates an owner-scoped project and revalidates after success", async () => {
    (prisma.project.create as any).mockResolvedValue({ id: "p_new", name: "New campaign" });

    await expect(createProject("New campaign")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New campaign" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_new",
        type: "project.create",
        payload: { name: "New campaign" },
      }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reuses an empty default campaign instead of creating duplicate sidebar rows", async () => {
    (prisma.project.findMany as any).mockResolvedValue([{ id: "p_empty", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);

    await expect(createProject("New campaign")).resolves.toEqual({ id: "p_empty" });

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { ownerId: "o1", name: "New campaign", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, editJson: true, coworkBrief: true, brandId: true, campaignId: true },
      take: 12,
    });
    expect(prisma.chatThread.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.shot.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.scheduledPost.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.canvasNode.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty" } });
    expect(prisma.genJob.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty" } });
    expect(prisma.generation.count).toHaveBeenCalledWith({ where: { ownerId: "o1", projectId: "p_empty", deletedAt: null } });
    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates a new default campaign when the existing default campaign has work", async () => {
    (prisma.project.findMany as any).mockResolvedValue([{ id: "p_used", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);
    (prisma.canvasNode.count as any).mockResolvedValue(1);
    (prisma.project.create as any).mockResolvedValue({ id: "p_new", name: "New campaign" });

    await expect(createProject("New campaign")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New campaign" },
    });
    expect(prisma.actionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: "o1",
        projectId: "p_new",
        type: "project.create",
        payload: { name: "New campaign" },
      }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("creates a new default campaign when the existing default campaign has storyboard shots", async () => {
    (prisma.project.findMany as any).mockResolvedValue([{ id: "p_storyboard", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);
    (prisma.shot.count as any).mockResolvedValue(1);
    (prisma.project.create as any).mockResolvedValue({ id: "p_new", name: "New campaign" });

    await expect(createProject("New campaign")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New campaign" },
    });
  });

  it("creates a new default campaign when the existing default campaign has scheduled posts", async () => {
    (prisma.project.findMany as any).mockResolvedValue([{ id: "p_schedule", editJson: null, coworkBrief: null, brandId: null, campaignId: null }]);
    (prisma.scheduledPost.count as any).mockResolvedValue(1);
    (prisma.project.create as any).mockResolvedValue({ id: "p_new", name: "New campaign" });

    await expect(createProject("New campaign")).resolves.toEqual({ id: "p_new" });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New campaign" },
    });
  });

  it("creates a new default campaign when the existing default campaign has project-level work", async () => {
    (prisma.project.findMany as any).mockResolvedValue([
      { id: "p_brief", editJson: null, coworkBrief: "Use neon product closeups", brandId: null, campaignId: null },
      { id: "p_edit", editJson: { timeline: { clips: [] } }, coworkBrief: null, brandId: null, campaignId: null },
    ]);
    (prisma.project.create as any).mockResolvedValue({ id: "p_new", name: "New campaign" });

    await expect(createProject("New campaign")).resolves.toEqual({ id: "p_new" });

    expect(prisma.chatThread.count).not.toHaveBeenCalled();
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "New campaign" },
    });
  });

  it("does not reuse campaigns for explicit custom names", async () => {
    (prisma.project.create as any).mockResolvedValue({ id: "p_custom", name: "Summer launch" });

    await expect(createProject("Summer launch")).resolves.toEqual({ id: "p_custom" });

    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { id: expect.any(String), ownerId: "o1", name: "Summer launch" },
    });
  });
});
