/**
 * 北极星 Canvas 页受控入口的选择逻辑与租户口径。
 *
 * #606 T7 之前这个文件还兼测手搓板的运行时(轮询循环、自动落位、重试呈现)。手搓板与
 * `immersive-canvas-runtime` 已随 T7 退役,那几组断言跟着走了;唯一那块画布的同款行为
 * 由内核自己的测试守着(`canvas-real-interaction` / `canvas-flow-lineage-ui` /
 * `northstar-canvas-convergence`)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCoworkThreads: vi.fn(),
  getEntities: vi.fn(),
  getMyAccount: vi.fn(),
  getOrCreateDefaultProject: vi.fn(),
  getProjects: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mocks.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/actions", () => ({ getOrCreateDefaultProject: mocks.getOrCreateDefaultProject }));
vi.mock("@/lib/data", () => ({ getCoworkThreads: mocks.getCoworkThreads, getEntities: mocks.getEntities, getProjects: mocks.getProjects }));
vi.mock("@/lib/dto", () => ({ toEntityDTO: (entity: { id: string }) => entity }));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/components/canvas/NorthstarCanvasWorkspace", () => ({ NorthstarCanvasWorkspace: vi.fn() }));

const {
  ImmersiveCanvasEntry,
  buildImmersiveCanvasCanonicalUrl,
  selectImmersiveProject,
  selectImmersiveThread,
} = await import("@/components/canvas/ImmersiveCanvasEntry");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ email: "owner@example.com", ownerId: "owner-1" });
  mocks.getOrCreateDefaultProject.mockResolvedValue({ id: "p-oldest" });
  mocks.getMyAccount.mockResolvedValue({ balance: 42 });
  mocks.getEntities.mockResolvedValue([]);
});

describe("immersive canvas owned runtime selection", () => {
  const projects = [
    { id: "p-oldest", name: "Oldest" },
    { id: "p-other", name: "Other" },
  ];

  it("uses an explicitly requested owned project without redirecting", () => {
    expect(selectImmersiveProject(projects, "p-oldest", "p-other")).toEqual({
      activeProjectId: "p-other",
      shouldRedirect: false,
    });
  });

  it("falls back to the first owned project and canonicalizes an invalid project", () => {
    expect(selectImmersiveProject(projects, "p-oldest", "p-forged")).toEqual({
      activeProjectId: "p-oldest",
      shouldRedirect: true,
    });
  });

  it("uses the ensured owner project when the project list is momentarily empty", () => {
    expect(selectImmersiveProject([], "p-ensured", undefined)).toEqual({
      activeProjectId: "p-ensured",
      shouldRedirect: false,
    });
  });

  const threads = [
    {
      id: "t-pinned-old",
      projectId: "p-oldest",
      title: "Pinned but older",
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      pinnedAt: new Date("2026-07-02T00:00:00.000Z"),
    },
    {
      id: "t-recent",
      projectId: "p-oldest",
      title: "Most recent",
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      pinnedAt: null,
    },
  ];

  it("uses an explicit valid thread even when another thread is newer", () => {
    expect(selectImmersiveThread(threads, "t-pinned-old")).toEqual({
      activeThreadId: "t-pinned-old",
      shouldRedirect: false,
    });
  });

  it("selects the most recently active thread when no thread was requested", () => {
    expect(selectImmersiveThread(threads, undefined)).toEqual({
      activeThreadId: "t-recent",
      shouldRedirect: false,
    });
  });

  it("canonicalizes an invalid thread to the most recently active owned thread", () => {
    expect(selectImmersiveThread(threads, "t-forged")).toEqual({
      activeThreadId: "t-recent",
      shouldRedirect: true,
    });
  });

  it("canonicalizes an invalid thread by removing it when the project has no threads", () => {
    expect(selectImmersiveThread([], "t-forged")).toEqual({
      activeThreadId: null,
      shouldRedirect: true,
    });
  });

  it("preserves unrelated deep-link params while canonicalizing project and thread", () => {
    const url = buildImmersiveCanvasCanonicalUrl(
      { project: "p-forged", thread: "t-forged", audience: "a-1", persona: ["face-1", "face-2"] },
      { activeProjectId: "p-oldest", activeThreadId: "t-recent", canonicalizeThread: true },
    );

    expect(url).toBe(
      "/create/canvas?project=p-oldest&thread=t-recent&audience=a-1&persona=face-1&persona=face-2",
    );
  });
});

describe("ImmersiveCanvasEntry", () => {
  it("loads only the authenticated owner's selected project and serializes the newest thread", async () => {
    mocks.getProjects.mockResolvedValue([
      { id: "p-oldest", name: "Oldest" },
      { id: "p-selected", name: "Selected" },
    ]);
    mocks.getCoworkThreads.mockResolvedValue([
      {
        id: "t-old",
        projectId: "p-selected",
        title: "Old",
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        pinnedAt: new Date("2026-07-02T00:00:00.000Z"),
      },
      {
        id: "t-new",
        projectId: "p-selected",
        title: "New",
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
        pinnedAt: null,
      },
    ]);

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: "p-selected" }),
    });

    expect(mocks.getProjects).toHaveBeenCalledWith("owner-1");
    expect(mocks.getCoworkThreads).toHaveBeenCalledWith("owner-1", "p-selected");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(element.props.runtimeContext).toEqual({
      projects: [
        { id: "p-oldest", name: "Oldest" },
        { id: "p-selected", name: "Selected" },
      ],
      threads: [
        {
          id: "t-old",
          projectId: "p-selected",
          title: "Old",
          updatedAt: "2026-07-01T00:00:00.000Z",
          pinnedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          id: "t-new",
          projectId: "p-selected",
          title: "New",
          updatedAt: "2026-07-16T00:00:00.000Z",
          pinnedAt: null,
        },
      ],
      activeProjectId: "p-selected",
      activeThreadId: "t-new",
      initialBalance: 42,
    });
  });

  it("redirects an invalid project and thread to an owned canonical URL", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-oldest", name: "Oldest" }]);
    mocks.getCoworkThreads.mockResolvedValue([
      {
        id: "t-new",
        projectId: "p-oldest",
        title: "New",
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
        pinnedAt: null,
      },
    ]);
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });

    await expect(ImmersiveCanvasEntry({
      searchParams: Promise.resolve({
        project: "p-forged",
        thread: "t-forged",
        audience: "audience-1",
      }),
    })).rejects.toThrow(
      "NEXT_REDIRECT:/create/canvas?project=p-oldest&thread=t-new&audience=audience-1",
    );
  });
});
