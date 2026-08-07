import { describe, it, expect, vi, beforeEach } from "vitest";

// W-B3-D v2 (小节审 review #271 comment 4952217527): the ctx.projects port's remove() carries the
// Otto-only EMPTY-PROJECT hard gate — deleteProject physically destroys the project's Generations
// (settled PAID media included, no refund), and the human UI fronts that with a type-the-full-name
// confirm the Otto path lacks. So: any live Generation in the Project ⇒ deterministic hard refusal
// directing the user to the UI's by-hand confirm; only an EMPTY Project passes through. Fail-closed
// on a failing count read. The gate lives in the port, NOT in deleteProject — the human UI's
// legitimate type-to-confirm hard delete is untouched.

const { mockGenerationCount, mockGetOrCreateDefaultProject, mockCreateProject, mockRenameProject, mockSetProjectPinned, mockDeleteProject } = vi.hoisted(() => ({
  mockGenerationCount: vi.fn(),
  mockGetOrCreateDefaultProject: vi.fn(),
  mockCreateProject: vi.fn(),
  mockRenameProject: vi.fn(),
  mockSetProjectPinned: vi.fn(),
  mockDeleteProject: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    generation: { count: mockGenerationCount },
  },
}));
vi.mock("../actions", () => ({
  getOrCreateDefaultProject: mockGetOrCreateDefaultProject,
  createProject: mockCreateProject,
  renameProject: mockRenameProject,
  setProjectPinned: mockSetProjectPinned,
  deleteProject: mockDeleteProject,
}));

import { makeOttoProjectsPort } from "../otto-projects-port";

const port = () => makeOttoProjectsPort("owner-1");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("remove — empty-project hard gate (deterministic, no model self-confirmation)", () => {
  it("a project holding SETTLED PAID generations is refused and never reaches deleteProject", async () => {
    // Fixture narrative: 3 live Generations produced by charged GenJobs (settled spend) — the exact
    // asset class deleteProject would physically destroy with no refund.
    mockGenerationCount.mockResolvedValue(3);
    const res = (await port().remove("proj-paid")) as { error: string };
    expect(res.error).toContain("paid work");
    expect(res.error).toContain("by hand from the project's menu in the sidebar");
    expect(res.error).not.toMatch(/\bcampaigns?\b|\/campaign\b/i);
    expect(res.error).toContain("type");
    expect(mockDeleteProject).not.toHaveBeenCalled();
  });

  it("a project holding ANY live generation (e.g. a single upload/crop) is refused too", async () => {
    // The gate is count > 0 on ANY live Generation — not just paid ones (uploads/crops land in the
    // same Library read; deleting them via a one-liner is equally silent destruction).
    mockGenerationCount.mockResolvedValue(1);
    const res = (await port().remove("proj-one-upload")) as { error: string };
    expect(res.error).toContain("can't delete it from here");
    expect(mockDeleteProject).not.toHaveBeenCalled();
    // The count read is scoped owner + project + live (deletedAt null).
    expect(mockGenerationCount).toHaveBeenCalledWith({
      where: { projectId: "proj-one-upload", ownerId: "owner-1", deletedAt: null },
    });
  });

  it("an EMPTY project (zero live generations) passes through to the guarded deleteProject", async () => {
    mockGenerationCount.mockResolvedValue(0);
    mockDeleteProject.mockResolvedValue({ ok: true });
    const res = await port().remove("proj-empty");
    expect(res).toEqual({ ok: true });
    expect(mockDeleteProject).toHaveBeenCalledWith("proj-empty");
  });

  it("fail-closed: a failing count read REFUSES the delete (never 'couldn't check, delete anyway')", async () => {
    mockGenerationCount.mockRejectedValue(new Error("db down"));
    const res = (await port().remove("proj-any")) as { error: string };
    expect(res.error).toContain("won't delete");
    expect(res.error).not.toMatch(/\bcampaigns?\b|\/campaign\b/i);
    expect(mockDeleteProject).not.toHaveBeenCalled();
  });
});

describe("other operations — thin closures over the shared actions (no gate)", () => {
  it("getDefault / create / rename / setPinned pass straight through", async () => {
    mockGetOrCreateDefaultProject.mockResolvedValue({ id: "p-default" });
    mockCreateProject.mockResolvedValue({ id: "p-new" });
    mockRenameProject.mockResolvedValue({ ok: true, name: "Q3" });
    mockSetProjectPinned.mockResolvedValue({ ok: true, pinnedAt: null });
    const c = port();
    expect(await c.getDefault()).toEqual({ id: "p-default" });
    expect(await c.create("Ramadan")).toEqual({ id: "p-new" });
    expect(mockCreateProject).toHaveBeenCalledWith("Ramadan");
    expect(await c.rename("p1", "Q3")).toEqual({ ok: true, name: "Q3" });
    expect(await c.setPinned("p1", false)).toEqual({ ok: true, pinnedAt: null });
    expect(mockGenerationCount).not.toHaveBeenCalled();
  });
});
