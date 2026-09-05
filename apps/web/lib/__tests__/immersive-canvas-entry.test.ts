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
  getCoworkThreadPage: vi.fn(),
  resolveCoworkResultUrls: vi.fn(),
  resolveCoworkMessageReferences: vi.fn(),
  getCanvasConversationHandoff: vi.fn(),
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
vi.mock("@/lib/data", () => ({
  getCoworkThreadPage: mocks.getCoworkThreadPage,
  getCoworkThreads: mocks.getCoworkThreads,
  getEntities: mocks.getEntities,
  getProjects: mocks.getProjects,
  resolveCoworkResultUrls: mocks.resolveCoworkResultUrls,
  resolveCoworkMessageReferences: mocks.resolveCoworkMessageReferences,
}));
vi.mock("@/lib/dto", () => ({
  toEntityDTO: (entity: { id: string }) => entity,
  toChatThreadDTO: (thread: {
    id: string;
    projectId: string;
    title: string;
    updatedAt: Date;
    pinnedAt: Date | null;
    messages: unknown[];
  }) => ({
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    updatedAt: thread.updatedAt.toISOString(),
    pinnedAt: thread.pinnedAt?.toISOString() ?? null,
    messages: thread.messages,
  }),
}));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/canvas-entry-actions", () => ({
  getCanvasConversationHandoff: mocks.getCanvasConversationHandoff,
}));
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
  mocks.getMyAccount.mockResolvedValue({ balance: 42, balanceUsd: 4.2 });
  mocks.getEntities.mockResolvedValue([]);
  mocks.getCoworkThreadPage.mockResolvedValue(null);
  mocks.resolveCoworkResultUrls.mockResolvedValue(new Map());
  mocks.resolveCoworkMessageReferences.mockResolvedValue(new Map());
  mocks.getCanvasConversationHandoff.mockResolvedValue(null);
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

  /**
   * FRONT-A14(判官 P2-3)—— P1-010 的**镜像**。
   *
   * P1-010 是「侧栏面板续到了画布对话」。反方向同一个病:画布也按 project 取最新一条,
   * 不看来源 —— 商家在侧栏 Otto 聊完,转头打开 Create,画布接上的是那条侧栏对话。
   */
  const withPanelThread = [
    ...threads,
    {
      id: "t-panel-newest",
      projectId: "p-oldest",
      title: "Asked in the sidebar",
      updatedAt: new Date("2026-08-20T00:00:00.000Z"),
      pinnedAt: null,
      surface: "panel",
    },
  ];

  it("FRONT-A14 — the canvas never auto-resumes a conversation the sidebar panel started", () => {
    // `t-panel-newest` 是最新的一条 —— 旧规则会选它,那正是这一条要挡住的。
    expect(selectImmersiveThread(withPanelThread, undefined)).toEqual({
      activeThreadId: "t-recent",
      shouldRedirect: false,
    });
  });

  it("FRONT-A14 — a deep-linked panel conversation still opens on the canvas: the merchant named it", () => {
    expect(selectImmersiveThread(withPanelThread, "t-panel-newest")).toEqual({
      activeThreadId: "t-panel-newest",
      shouldRedirect: false,
    });
  });

  it("FRONT-A14 — a conversation with no recorded origin is still resumed, so nothing regresses for older threads", () => {
    // 老行 `surface` 是空的。排的是「确知是面板的」,不是「不是画布的」—— 商家原来能接回
    // 哪一条,现在还是哪一条(零降级)。
    expect(threads.every((t) => !("surface" in t))).toBe(true);
    expect(selectImmersiveThread(threads, undefined)).toEqual({
      activeThreadId: "t-recent",
      shouldRedirect: false,
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
    mocks.getCoworkThreadPage.mockResolvedValue({
      id: "t-new",
      projectId: "p-selected",
      title: "New",
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      pinnedAt: null,
      messages: [],
      hasOlderMessages: false,
    });

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
      initialBalanceUsd: 4.2,
      activeThread: {
        id: "t-new",
        projectId: "p-selected",
        title: "New",
        updatedAt: "2026-07-16T00:00:00.000Z",
        pinnedAt: null,
        messages: [],
        hasOlderMessages: false,
      },
      pendingFirst: null,
    });
  });

  it("passes a valid empty-thread handoff once as the first durable Otto turn", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-oldest", name: "Raya stills" }]);
    mocks.getCoworkThreads.mockResolvedValue([{
      id: "t-new",
      projectId: "p-oldest",
      title: "Merdeka gift box",
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      pinnedAt: null,
    }]);
    mocks.getCoworkThreadPage.mockResolvedValue({
      id: "t-new",
      projectId: "p-oldest",
      title: "Merdeka gift box",
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      pinnedAt: null,
      messages: [],
      hasOlderMessages: false,
    });
    mocks.getCanvasConversationHandoff.mockResolvedValue({
      prompt: "Create a Merdeka gift-box hero",
      entityIds: [],
      sourceGenerationIds: [],
      referenceVideoGenerationIds: [],
    });

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: "p-oldest", thread: "t-new", handoff: "handoff-1" }),
    });

    expect(mocks.getCanvasConversationHandoff).toHaveBeenCalledWith({
      ownerId: "owner-1",
      handoffId: "handoff-1",
      projectId: "p-oldest",
      threadId: "t-new",
    });
    expect(element.props.runtimeContext.pendingFirst).toEqual({
      handoffId: "handoff-1",
      text: "Create a Merdeka gift-box hero",
    });
  });

  /**
   * FRONT-A14(规格 §7.3⑨)—— 起步页挂的参考,要跟着这条 handoff 进**首轮**。
   * 没有这一条,商家在 Create 上挑的那张图会在 navigation 之后无声消失:画布照样开、话照样送,
   * 只是那件参考从来没上车 —— 而屏幕上没有任何地方会说它掉了。
   */
  it("FRONT-A14: 起步页挂的引用随 handoff 进画布首轮", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-oldest", name: "Raya stills" }]);
    mocks.getCoworkThreads.mockResolvedValue([{
      id: "t-new",
      projectId: "p-oldest",
      title: "Merdeka gift box",
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      pinnedAt: null,
    }]);
    mocks.getCoworkThreadPage.mockResolvedValue({
      id: "t-new",
      projectId: "p-oldest",
      title: "Merdeka gift box",
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      pinnedAt: null,
      messages: [],
      hasOlderMessages: false,
    });
    mocks.getCanvasConversationHandoff.mockResolvedValue({
      prompt: "Put her in the new hoodie",
      entityIds: ["ent-1"],
      sourceGenerationIds: ["gen-img"],
      referenceVideoGenerationIds: ["gen-vid"],
    });

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: "p-oldest", thread: "t-new", handoff: "handoff-1" }),
    });

    expect(element.props.runtimeContext.pendingFirst).toEqual({
      handoffId: "handoff-1",
      text: "Put her in the new hoodie",
      entityIds: ["ent-1"],
      sourceGenerationIds: ["gen-img"],
      referenceVideoGenerationIds: ["gen-vid"],
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
