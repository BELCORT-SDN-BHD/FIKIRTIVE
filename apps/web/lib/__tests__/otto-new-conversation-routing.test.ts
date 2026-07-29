// @vitest-environment jsdom
/**
 * otto-new-conversation-routing.test.ts — real jsdom render + click/route tests for two
 * Otto entry flows from #513 group D (New campaign direct-build-direct-enter, and the
 * always-visible header "New conversation" button), plus the #522 round-3 popstate fix
 * (Back/Forward through a client-pushed URL must resync activeThreadId, not just `view`).
 *
 * Round 3 (#522) replaces the previous version of this file, which only grepped
 * OttoApp.tsx's source text for literal strings — no component was ever rendered, no
 * click ever fired, no route ever executed. These tests render the REAL OttoApp
 * component (react-dom/client + act, the interactive harness established in
 * crm-zero-channel-entry.test.ts), drive it with real DOM clicks and real popstate
 * events, and assert on what the real handlers actually did: the server action called,
 * the URL left in the address bar, and the thread the component ends up showing.
 *
 * OttoNav and OttoView are stubbed to thin, prop-driven stand-ins — their own internal
 * rendering has its own suites; what's under test here is OttoApp's own routing/state
 * logic (handleNewCampaign, handleNewChat, the popstate listener).
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThreadDTO } from "@/lib/types";

const { routerPush, routerReplace, routerRefresh } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: routerRefresh }),
}));

const { createProjectMock } = vi.hoisted(() => ({ createProjectMock: vi.fn() }));
vi.mock("@/lib/actions", () => ({
  createProject: createProjectMock,
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  autoTitleProjectIfDefault: vi.fn(),
  setProjectPinned: vi.fn(),
}));

vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));

vi.mock("@/lib/otto-client-actions", () => ({
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));

vi.mock("@/components/otto/OttoNav", () => ({
  OttoNav: ({ onNewCampaign }: { onNewCampaign: () => Promise<boolean> }) =>
    createElement(
      "button",
      { type: "button", "data-testid": "nav-new-campaign", onClick: () => { void onNewCampaign(); } },
      "New campaign",
    ),
}));

vi.mock("@/components/otto/OttoView", () => ({
  OttoView: ({
    activeThreadId,
    onNewConvo,
    onThreadStarted,
    projectId,
  }: {
    activeThreadId: string | null;
    onNewConvo: () => void;
    onThreadStarted: (thread: ChatThreadDTO) => void;
    projectId: string;
  }) =>
    createElement(
      "div",
      null,
      createElement("div", { "data-testid": "active-thread-id" }, activeThreadId ?? ""),
      createElement(
        "button",
        { type: "button", "data-testid": "header-new-conversation", onClick: onNewConvo },
        "New conversation",
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "simulate-thread-started",
          // Mirrors what OttoChatStream does on a brand-new conversation's first turn:
          // the server durably creates the thread, then the client is told about it.
          onClick: () =>
            onThreadStarted({
              id: "thr_new",
              projectId,
              title: "New conversation",
              updatedAt: "2026-07-29T00:00:00.000Z",
              messages: [],
            }),
        },
        "simulate first turn creating a thread",
      ),
    ),
}));

import { OttoApp, type OttoAppProps } from "@/components/otto/OttoApp";

// React refuses act() outside a configured act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let locationAssignSpy: ReturnType<typeof vi.fn>;

// jsdom's window.location.assign is a non-configurable, non-writable data property (and
// really calling it just logs "Not implemented: navigation", it never updates href) — so
// it can't be spied on directly, and a Proxy wrapping the real Location object trips the
// non-configurable-property invariant. Instead, swap window's own (configurable) `location`
// accessor for a Proxy over a plain dummy target that forwards every read/write to the real
// Location object except `assign`, which resolves to our spy. pathname/search/pushState all
// keep working live off the same underlying real Location.
const realLocation = window.location;
beforeEach(() => {
  locationAssignSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    get() {
      return new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "assign") return locationAssignSpy;
            const value = Reflect.get(realLocation, prop, realLocation);
            return typeof value === "function" ? value.bind(realLocation) : value;
          },
          set(_target, prop, value) {
            (realLocation as unknown as Record<string, unknown>)[prop as string] = value;
            return true;
          },
        },
      );
    },
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// Simulates the browser having traversed history to `url`: the address bar changes and a
// popstate event fires, exactly as it would for a real Back/Forward — without depending
// on jsdom's own history.back()/forward() task-queue timing.
async function popTo(url: string) {
  await act(async () => {
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

function activeThreadText(dom: HTMLElement): string {
  return dom.querySelector('[data-testid="active-thread-id"]')!.textContent ?? "";
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function baseProps(over: Partial<OttoAppProps> = {}): OttoAppProps {
  return {
    projectId: "proj_1",
    projects: [{ id: "proj_1", name: "Test campaign" }],
    activeProjectId: "proj_1",
    sidebarThreads: [],
    initialActiveThreadId: null,
    entities: [],
    threads: [],
    balanceUsd: 0,
    balanceCredits: 0,
    userName: "founder",
    userEmail: "founder@example.com",
    memory: [],
    records: [],
    ads: [],
    adJobs: [],
    account: null,
    analytics: { state: "notConnected" },
    ottoStreamEnabled: true,
    ...over,
  };
}

describe("Otto \"New campaign\" direct-build-direct-enter", () => {
  it("creates the campaign and navigates straight into it — no stale thread/new carried over", async () => {
    createProjectMock.mockResolvedValue({ id: "proj_new" });
    window.history.pushState(null, "", "/otto?project=proj_1&thread=thr_existing");

    const dom = await render(createElement(OttoApp, baseProps()));
    await click(dom.querySelector('[data-testid="nav-new-campaign"]')!);

    expect(createProjectMock).toHaveBeenCalledWith("New campaign");
    expect(locationAssignSpy).toHaveBeenCalledWith("/otto?project=proj_new");
  });

  it("guards against a double-submit while the create is in flight", async () => {
    let resolveCreate!: (value: { id: string }) => void;
    createProjectMock.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));

    const dom = await render(createElement(OttoApp, baseProps()));
    const button = dom.querySelector('[data-testid="nav-new-campaign"]')!;

    await click(button); // starts the in-flight create
    await click(button); // fired again before the first resolves

    expect(createProjectMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveCreate({ id: "proj_new" }));
    expect(locationAssignSpy).toHaveBeenCalledWith("/otto?project=proj_new");
  });
});

describe("Otto header \"New conversation\" routing", () => {
  it("resets the active thread and routes to ?new=1 (not a bare state reset the URL never learns about)", async () => {
    window.history.pushState(null, "", "/otto?project=proj_1&thread=thr_existing");
    const dom = await render(createElement(OttoApp, baseProps({
      initialActiveThreadId: "thr_existing",
      threads: [{ id: "thr_existing", projectId: "proj_1", title: "Existing", updatedAt: "2026-07-29T00:00:00.000Z", messages: [] }],
    })));
    expect(activeThreadText(dom)).toBe("thr_existing");

    await click(dom.querySelector('[data-testid="header-new-conversation"]')!);

    expect(activeThreadText(dom)).toBe("");
    expect(currentUrl()).toBe("/otto?project=proj_1&new=1");
    expect(routerReplace).toHaveBeenCalledWith("/otto?project=proj_1&new=1");
  });
});

describe("Otto popstate restores the active thread, not only the view (#522 round-3 P1)", () => {
  it("Back from a just-created thread to the ?new=1 entry stops showing the just-created conversation", async () => {
    window.history.pushState(null, "", "/otto?project=proj_1&new=1");
    const dom = await render(createElement(OttoApp, baseProps({ initialActiveThreadId: null })));
    expect(activeThreadText(dom)).toBe("");

    // The first turn lands and the thread is durably created — OttoApp is told via
    // onThreadStarted, which pushes the URL with a raw history.pushState (no Next.js
    // navigation, so no remount) exactly like the real handleThreadStarted callback.
    await click(dom.querySelector('[data-testid="simulate-thread-started"]')!);
    expect(activeThreadText(dom)).toBe("thr_new");
    expect(currentUrl()).toBe("/otto?project=proj_1&thread=thr_new");

    // Browser Back: the address bar returns to the pre-thread ?new=1 entry.
    await popTo("/otto?project=proj_1&new=1");

    // The regression (#522): activeThreadId used to stay "thr_new" here because the
    // popstate handler only resynced `view`. It must now match the URL: no thread.
    expect(activeThreadText(dom)).toBe("");
  });

  it("Forward back onto a ?thread= entry restores that thread", async () => {
    window.history.pushState(null, "", "/otto?project=proj_1&new=1");
    const dom = await render(createElement(OttoApp, baseProps({ initialActiveThreadId: null })));

    await click(dom.querySelector('[data-testid="simulate-thread-started"]')!);
    await popTo("/otto?project=proj_1&new=1");
    expect(activeThreadText(dom)).toBe("");

    await popTo("/otto?project=proj_1&thread=thr_new");
    expect(activeThreadText(dom)).toBe("thr_new");
  });

  it("does not clobber the active thread when popping to a non-otto view (view URLs never encoded a thread)", async () => {
    window.history.pushState(null, "", "/otto?project=proj_1&thread=thr_existing");
    const dom = await render(createElement(OttoApp, baseProps({
      initialActiveThreadId: "thr_existing",
      threads: [{ id: "thr_existing", projectId: "proj_1", title: "Existing", updatedAt: "2026-07-29T00:00:00.000Z", messages: [] }],
    })));

    await popTo("/otto?project=proj_1&view=library");

    // view-only entries were never pushed with a thread param either way — restoring
    // the "otto" thread only when the URL is actually the "otto" view is the fix's
    // other half, so this must not regress to activeThreadId=null.
    expect(activeThreadText(dom)).toBe("thr_existing");
  });
});
