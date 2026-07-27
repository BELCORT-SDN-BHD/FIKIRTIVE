import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCoworkThreads: vi.fn(),
  getMyAccount: vi.fn(),
  getOrCreateDefaultProject: vi.fn(),
  getProjects: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  requireOwner: vi.fn(),
  syncOttoCanvasNodes: vi.fn(),
  useCanvasGen: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mocks.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/actions", () => ({ getOrCreateDefaultProject: mocks.getOrCreateDefaultProject }));
vi.mock("@/lib/data", () => ({ getCoworkThreads: mocks.getCoworkThreads, getProjects: mocks.getProjects }));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/canvas-actions", () => ({ deleteCanvasNode: vi.fn(), moveCanvasNode: vi.fn() }));
vi.mock("@/lib/otto-canvas-bridge", () => ({ syncOttoCanvasNodes: mocks.syncOttoCanvasNodes }));
vi.mock("@/components/canvas/useCanvasGen", () => ({ useCanvasGen: mocks.useCanvasGen }));
vi.mock("@/components/northstar/create/canvas-page", () => ({ CanvasPage: vi.fn() }));

const {
  ImmersiveCanvasEntry,
  buildImmersiveCanvasCanonicalUrl,
  selectImmersiveProject,
  selectImmersiveThread,
} = await import("@/components/canvas/ImmersiveCanvasEntry");
const {
  canvasFailureRetryMode,
  canvasVariantClusterFootprint,
  nearestOpenCanvasPosition,
  ottoCanvasSyncEvents,
  startVisibleCanvasSyncLoop,
} = await import("@/components/canvas/immersive-canvas-runtime");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ email: "owner@example.com", ownerId: "owner-1" });
  mocks.getOrCreateDefaultProject.mockResolvedValue({ id: "p-oldest" });
  mocks.getMyAccount.mockResolvedValue({ balance: 42 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("immersive canvas live sync loop", () => {
  it("polls only while visible and never overlaps an unfinished sync", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "visible";
    let visibilityListener: () => void = () => undefined;
    const visibility = {
      get visibilityState() { return visibilityState; },
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        visibilityListener = listener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

    let finishFirst: () => void = () => undefined;
    const sync = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(undefined);
    const stop = startVisibleCanvasSyncLoop(sync, visibility, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sync).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(2);

    visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(2);
    visibilityState = "visible";
    visibilityListener();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sync).toHaveBeenCalledTimes(3);
    expect(visibility.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});

describe("immersive Canvas Otto live events", () => {
  const node = (
    id: string,
    origin: "otto" | null,
    status = "pending",
    url: string | null = null,
  ) => ({
    id,
    type: "image" as const,
    pos: { x: 0, y: 0, w: 320, h: 320 },
    status,
    url,
    prompt: "result",
    threadId: "thread-1",
    origin,
  });

  it("keeps hydration quiet and never labels a cross-tab manual node as Otto", () => {
    const nodes = [node("otto-new", "otto"), node("manual-new", null)];
    expect(ottoCanvasSyncEvents(new Map(), nodes, false)).toEqual([]);
    expect(ottoCanvasSyncEvents(new Map(), nodes, true)).toEqual([
      { id: "otto-new", phase: "started" },
    ]);
  });

  it("reports the pending start and the same node's later result as distinct Otto events", () => {
    const pending = node("otto-job", "otto");
    expect(ottoCanvasSyncEvents(new Map(), [pending], true)).toEqual([
      { id: "otto-job", phase: "started" },
    ]);
    expect(ottoCanvasSyncEvents(
      new Map([[pending.id, pending]]),
      [node("otto-job", "otto", "done", "/files/result.png")],
      true,
    )).toEqual([{ id: "otto-job", phase: "result" }]);
  });
});

describe("immersive canvas automatic placement", () => {
  const preferred = { x: 96, y: 120, w: 224, h: 224 };

  it("keeps the preferred position on an empty canvas", () => {
    expect(nearestOpenCanvasPosition(preferred, [])).toEqual(preferred);
  });

  it("uses the next row when a seed and its right-side A/B slot occupy the first row", () => {
    expect(nearestOpenCanvasPosition(preferred, [
      preferred,
      { x: 340, y: 120, w: 224, h: 224 },
    ])).toEqual({ x: 96, y: 364, w: 224, h: 224 });
  });

  it("puts a new top-level card below the occupied preferred slot before trying farther right", () => {
    expect(nearestOpenCanvasPosition(preferred, [preferred])).toEqual({
      x: 96,
      y: 364,
      w: 224,
      h: 224,
    });
  });

  it("keeps a source-based preferred branch when free and moves below when that slot is occupied", () => {
    const source = { x: 96, y: 120, w: 224, h: 224 };
    const branch = { x: source.x + source.w + 56, y: source.y, w: source.w, h: source.h };
    expect(nearestOpenCanvasPosition(branch, [source])).toEqual(branch);
    expect(nearestOpenCanvasPosition(branch, [source, branch])).toEqual({
      x: 376,
      y: 364,
      w: 224,
      h: 224,
    });
  });

  it("reserves the full 2×2 footprint so later variants cannot cover an existing card", () => {
    const card = { x: 96, y: 120, w: 224, h: 224 };
    const footprint = canvasVariantClusterFootprint(card, 4);
    expect(footprint).toEqual({ x: 96, y: 120, w: 468, h: 468 });
    expect(nearestOpenCanvasPosition(footprint, [
      { x: 340, y: 120, w: 224, h: 224 },
    ])).toEqual({ x: 96, y: 608, w: 468, h: 468 });
  });
});

describe("immersive Canvas retry presentation", () => {
  it("keeps unknown work on the same action and restores deterministic rejections as new review", () => {
    expect(canvasFailureRetryMode(
      "We couldn't confirm whether generation started — retry this same action.",
      true,
    )).toBe("same-action");
    expect(canvasFailureRetryMode(
      "Your image is generating — the card didn't appear yet. Refresh Canvas to recover it without paying again.",
      true,
    )).toBe("same-action");
    expect(canvasFailureRetryMode(
      "Generation could not start because the queue was unavailable. Nothing was charged — retry when it is available.",
      true,
    )).toBe("new-action");
    expect(canvasFailureRetryMode("Could not load status.", false)).toBeUndefined();
  });
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
      "/northstar-immersive/create/canvas?project=p-oldest&thread=t-recent&audience=a-1&persona=face-1&persona=face-2",
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
      "NEXT_REDIRECT:/northstar-immersive/create/canvas?project=p-oldest&thread=t-new&audience=audience-1",
    );
  });
});
