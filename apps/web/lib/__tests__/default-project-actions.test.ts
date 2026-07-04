import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guard", () => ({ requireOwner: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: vi.fn(), create: vi.fn() },
    actionEvent: { create: vi.fn() },
  },
}));

import { getOrCreateDefaultProject } from "@/lib/actions";
import { requireOwner } from "@/lib/auth-guard";
import { prisma } from "@fikirtive/db";
import { revalidatePath } from "next/cache";

beforeEach(() => {
  vi.clearAllMocks();
  (requireOwner as any).mockResolvedValue({ ownerId: "o1", email: "owner@example.test" });
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
