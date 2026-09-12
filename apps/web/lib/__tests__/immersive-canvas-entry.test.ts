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
  findOwnedThreadForDeepLink: vi.fn(),
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
  findOwnedThreadForDeepLink: mocks.findOwnedThreadForDeepLink,
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
  isUnresolvedProjectDeepLink,
  isUnresolvedThreadDeepLink,
  selectImmersiveProject,
  selectImmersiveThread,
} = await import("@/components/canvas/ImmersiveCanvasEntry");
const { CANVAS_DEEP_LINK_REFUSAL_COPY } = await import("@/components/canvas/CanvasDeepLinkRefused");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ email: "owner@example.com", ownerId: "owner-1" });
  // FSE-207b default: no owned thread resolves the point lookup. Any test that passes a
  // `thread` search param and expects it to resolve must override this with a match.
  mocks.findOwnedThreadForDeepLink.mockResolvedValue(null);
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
    });
  });

  it("uses the ensured owner project when the project list is momentarily empty", () => {
    expect(selectImmersiveProject([], "p-ensured", undefined)).toEqual({
      activeProjectId: "p-ensured",
    });
  });

  /**
   * FSE-207 —— 「这条 `?project=` 打不开」现在是一道独立的题,在任何写入之前问。
   * 从前它藏在 `selectImmersiveProject` 的 `shouldRedirect` 里,而那时兜底画布已经建好了。
   */
  it("FSE-207 — a project deep link outside the merchant's own canvases is unresolved", () => {
    expect(isUnresolvedProjectDeepLink(projects, "p-other-tenant")).toBe(true);
  });

  it("FSE-207 — the merchant's own canvas deep link resolves, so nothing is refused", () => {
    expect(isUnresolvedProjectDeepLink(projects, "p-other")).toBe(false);
  });

  it("FSE-207 — no deep link at all is not a refusal: that is the ordinary open", () => {
    expect(isUnresolvedProjectDeepLink(projects, undefined)).toBe(false);
    expect(isUnresolvedProjectDeepLink([], undefined)).toBe(false);
  });

  /**
   * FSE-207b —— 同一份 §5 登记行的「未做」①:project 深链(FSE-207,PR #1396)已经改成
   * 「在自己的清单里」判定 ＋ 拒绝页,`thread` 深链走同一个判定(`isUnresolvedDeepLinkId`)。
   * 这里的清单来自租户名下**所有** project 里的对话(生产码里是 `findOwnedThreadForDeepLink`
   * 的一次精确点查,判官 P2-1 修根,PR #1414),不是当前那张画布的 `getCoworkThreads`
   * (否则「同一 tenant、不同 project」的合法深链会被误判成跨租户)。
   */
  it("FSE-207b — a thread deep link outside the merchant's own conversations is unresolved", () => {
    const ownThreadIds = [{ id: "t-mine-1" }, { id: "t-mine-2" }];
    expect(isUnresolvedThreadDeepLink(ownThreadIds, "t-someone-elses")).toBe(true);
  });

  it("FSE-207b — the merchant's own thread deep link resolves, so nothing is refused", () => {
    const ownThreadIds = [{ id: "t-mine-1" }, { id: "t-mine-2" }];
    expect(isUnresolvedThreadDeepLink(ownThreadIds, "t-mine-2")).toBe(false);
  });

  it("FSE-207b — no thread deep link at all is not a refusal: that is the ordinary open", () => {
    expect(isUnresolvedThreadDeepLink([{ id: "t-mine-1" }], undefined)).toBe(false);
    expect(isUnresolvedThreadDeepLink([], undefined)).toBe(false);
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
    mocks.findOwnedThreadForDeepLink.mockResolvedValue({ id: "t-new", projectId: "p-oldest" });
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
    mocks.findOwnedThreadForDeepLink.mockResolvedValue({ id: "t-new", projectId: "p-oldest" });
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

  /**
   * FSE-207b 之后(判官 P2-2 修根,PR #1414):一个「不在当前这张画布里」的 thread id 分两种
   * 情形——真是别人的/伪造的(`isUnresolvedThreadDeepLink` 判「否」,交拒绝页,见下方
   * FSE-207b 组),或者**是商家自己名下、只是挂在另一张画布上**的合法对话。
   *
   * 后一种从前借 `selectImmersiveThread` 的既有归一化处理:那条归一化只知道「这条 id 不在
   * 当前画布的清单里」,于是把商家悄悄换到当前画布里**另一条**对话上(`t-new`)——与他点的
   * 链接(`t-elsewhere`)毫无关系,只是顺手把施工者的改名钉成了行为,没人审过这条到底对不
   * 对。点查(`findOwnedThreadForDeepLink`)已经把这条 thread 真正挂在哪张画布上带回来了,
   * 现在直接重定向到它自己所在的那张画布——同一条 thread,不换成别的。
   */
  it("redirects a thread that belongs to another of the merchant's own canvases to that canvas's canonical URL", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-oldest", name: "Oldest" }]);
    mocks.findOwnedThreadForDeepLink.mockResolvedValue({ id: "t-elsewhere", projectId: "p-other" });
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });

    await expect(ImmersiveCanvasEntry({
      searchParams: Promise.resolve({
        project: "p-oldest",
        thread: "t-elsewhere",
        audience: "audience-1",
      }),
    })).rejects.toThrow(
      "NEXT_REDIRECT:/create/canvas?project=p-other&thread=t-elsewhere&audience=audience-1",
    );
    // 纠正发生在读错画布的那次查询之前:p-oldest 的对话列表一次都不该被读。
    expect(mocks.getCoworkThreads).not.toHaveBeenCalled();
  });

  /* ── FSE-207 ─────────────────────────────────────────────────────────────────
   * 规格 `docs/specs/creation-engine.md` §5(2026-09-11 行,Founder 2026-09-12 #1358
   * 裁「零写入」为硬口径)。复测句:跨租户打深链——地址不得被改写、不得新建 project、
   * 必须有一句人话。
   *
   * 这一组钉「地址不被改写」与「那一条会建画布的调用根本没发生」;库里真的零新增行由
   * `canvas-deeplink-cross-tenant-fse207.test.ts` 用真 Postgres 钉。
   * ────────────────────────────────────────────────────────────────────────── */

  it("FSE-207 — a canvas deep link from another workspace is refused in plain words, and the address is not rewritten", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-mine", name: "Mine" }]);

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: "canvas_someone_else" }),
    });

    // ① 地址不被改写:一次 redirect 都没有。
    expect(mocks.redirect).not.toHaveBeenCalled();
    // ② 一句人话。
    expect(element.type.name).toBe("CanvasDeepLinkRefused");
    expect(CANVAS_DEEP_LINK_REFUSAL_COPY.project.heading).toBe("This canvas isn't in your workspace");
    expect(CANVAS_DEEP_LINK_REFUSAL_COPY.project.body).toContain("belongs to a different workspace");
  });

  it("FSE-207 — refusing a deep link never reaches the call that creates a canvas", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-mine", name: "Mine" }]);

    await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: "canvas_someone_else" }),
    });

    // 这是走查里那一行 `Project` ＋ `ActionEvent project.create` 的唯一来源。
    expect(mocks.getOrCreateDefaultProject).not.toHaveBeenCalled();
    // 拒绝页之后一个读都不多发:租户的对话、余额、元素都与这条链接无关。
    expect(mocks.getCoworkThreads).not.toHaveBeenCalled();
    expect(mocks.getMyAccount).not.toHaveBeenCalled();
    expect(mocks.getEntities).not.toHaveBeenCalled();
  });

  it("FSE-207 — a merchant with no canvas yet still gets one bootstrapped when no deep link was given", async () => {
    // 改动把 `getProjects` 挪到了 bootstrap 前面 —— 第一次进画布的租户(清单为空)照旧
    // 拿到一张画布,而且它要出现在侧栏清单里,不是只作 activeProjectId。
    mocks.getProjects
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "p-fresh", name: "New canvas" }]);
    mocks.getOrCreateDefaultProject.mockResolvedValue({ id: "p-fresh" });
    mocks.getCoworkThreads.mockResolvedValue([]);

    const element = await ImmersiveCanvasEntry({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getOrCreateDefaultProject).toHaveBeenCalledTimes(1);
    expect(element.props.runtimeContext.activeProjectId).toBe("p-fresh");
    expect(element.props.runtimeContext.projects).toEqual([{ id: "p-fresh", name: "New canvas" }]);
  });

  /* ── FSE-207b ────────────────────────────────────────────────────────────────
   * 规格 `docs/specs/creation-engine.md` §5(2026-09-11 FSE-207 行,「未做」①)—— PR #1396
   * 只把 `?project=` 收成诚实拒绝页 ＋ 零写入,登记里明写 `?thread=` 仍按旧口径规范化
   * 重定向(改写地址、零人话),而对一个还没有任何画布的租户,那条重定向路径会先经过
   * `getOrCreateDefaultProject()` —— 一条伪造/别家的 `?thread=` 因此把一次访问 bootstrap
   * 成一张新画布(写入的因头是「访问」不是「链接」,不违「零写入」字面,但没人要这张画布,
   * 也没有一句话告诉商家发生了什么,违的是这条硬口径的精神)。
   *
   * 这一组同 FSE-207:钉「地址不被改写」与「那一条会建画布的调用根本没发生」;库里真的
   * 零新增行由 `canvas-deeplink-cross-tenant-thread-fse207b.test.ts` 用真 Postgres 钉。
   * ────────────────────────────────────────────────────────────────────────── */

  it("FSE-207b — a thread deep link from another workspace is refused in plain words, and the address is not rewritten", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-mine", name: "Mine" }]);
    mocks.findOwnedThreadForDeepLink.mockResolvedValue(null);

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ thread: "thread_someone_else" }),
    });

    // ① 地址不被改写:一次 redirect 都没有。
    expect(mocks.redirect).not.toHaveBeenCalled();
    // ② 一句人话,说的是「对话」不是「画布」(判官 P1-1 修根)—— thread 组自己的文案。
    expect(element.type.name).toBe("CanvasDeepLinkRefused");
    expect(CANVAS_DEEP_LINK_REFUSAL_COPY.thread.heading).toBe(
      "We can't open this conversation in your workspace",
    );
    expect(CANVAS_DEEP_LINK_REFUSAL_COPY.thread.body).toContain("belongs to a different workspace");
  });

  it("FSE-207b — refusing a thread deep link never reaches the call that creates a canvas", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-mine", name: "Mine" }]);
    mocks.findOwnedThreadForDeepLink.mockResolvedValue(null);

    await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ thread: "thread_someone_else" }),
    });

    // 这是「空租户被 bootstrap 出一张画布」那条症状的唯一来源。
    expect(mocks.getOrCreateDefaultProject).not.toHaveBeenCalled();
    // 拒绝页之后一个读都不多发:租户的对话、余额、元素都与这条链接无关。
    expect(mocks.getCoworkThreads).not.toHaveBeenCalled();
    expect(mocks.getMyAccount).not.toHaveBeenCalled();
    expect(mocks.getEntities).not.toHaveBeenCalled();
  });

  it("FSE-207b — a merchant with no canvas yet is not bootstrapped by a cross-tenant thread link", async () => {
    // 这是本票要修的那条具体症状:零画布租户打一条别家的 `?thread=`,旧口径会在改写地址
    // 之前先跑到 `getOrCreateDefaultProject()`,凭空多出一张画布。`getProjects` 在这条路径
    // 上应该连问都不问第二次(不需要为 bootstrap 重读)。
    mocks.getProjects.mockResolvedValue([]);
    mocks.findOwnedThreadForDeepLink.mockResolvedValue(null);

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ thread: "thread_someone_else" }),
    });

    expect(element.type.name).toBe("CanvasDeepLinkRefused");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getOrCreateDefaultProject).not.toHaveBeenCalled();
    expect(mocks.getProjects).toHaveBeenCalledTimes(1);
  });

  it("FSE-207b — a merchant's own thread deep link still opens that thread, and still writes nothing", async () => {
    mocks.getProjects.mockResolvedValue([{ id: "p-mine", name: "Mine" }]);
    mocks.findOwnedThreadForDeepLink.mockResolvedValue({ id: "t-mine", projectId: "p-mine" });
    mocks.getCoworkThreads.mockResolvedValue([
      {
        id: "t-mine",
        projectId: "p-mine",
        title: "Own conversation",
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
        pinnedAt: null,
      },
    ]);

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: "p-mine", thread: "t-mine" }),
    });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(element.type.name).not.toBe("CanvasDeepLinkRefused");
    expect(element.props.runtimeContext.activeThreadId).toBe("t-mine");
  });
});
