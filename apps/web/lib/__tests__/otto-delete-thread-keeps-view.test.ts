// @vitest-environment jsdom
/**
 * otto-delete-thread-keeps-view.test.ts — #969 判官 P2-5。
 *
 * 会话导轨在每一屏都在,所以「删除对话」可以在 Library、Analytics、Brand 上按下。删完之后
 * handleDeleteThread 会 router.replace 到 projectHref(...) —— 那串地址不带 ?view=,而不带
 * ?view= 的 /otto 就是对话屏。在「视图跟随 URL」落地之前这没人看得出来(URL 变了、屏幕不动);
 * 之后就变成:商家在 Library 上删掉一条对话,整个人被弹回聊天。
 *
 * 断言的是行为:挂真的 OttoApp,停在 Library,走真的删除路径,再看它把地址栏换成了什么。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThreadDTO } from "@/lib/types";
import type { OttoAppProps } from "@/components/otto/OttoApp";

const { routerReplace, deleteThreadMock, rail, dialog } = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  deleteThreadMock: vi.fn(),
  rail: { onDeleteThread: null as null | ((id: string) => void) },
  dialog: { confirm: null as null | (() => Promise<void>) },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, refresh: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/actions", () => ({
  createProject: vi.fn(), renameProject: vi.fn(), deleteProject: vi.fn(),
  autoTitleProjectIfDefault: vi.fn(), setProjectPinned: vi.fn(),
}));
vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));
vi.mock("@/lib/otto-client-actions", () => ({
  deleteCoworkThread: deleteThreadMock,
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: vi.fn() }));
vi.mock("@/components/otto/OttoView", () => ({ OttoView: () => null }));

// The rail lends out the same callback the real conversation menu presses.
vi.mock("@/components/otto/OttoNav", () => ({
  OttoNav: ({ onDeleteThread }: { onDeleteThread: (id: string) => void }) => {
    rail.onDeleteThread = onDeleteThread;
    return null;
  },
}));
// Confirming is the merchant's part; this stub lends out the button so the test can press it.
vi.mock("@/components/otto/OttoPromptDialog", () => ({
  OttoRenameDialog: () => null,
  OttoConfirmDialog: ({ open, confirmLabel, onConfirm }: {
    open: boolean; confirmLabel: string; onConfirm: () => Promise<void>;
  }) => {
    if (open && confirmLabel === "Delete conversation") dialog.confirm = onConfirm;
    return null;
  },
}));

const { OttoApp } = await import("@/components/otto/OttoApp");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const thread = (id: string): ChatThreadDTO => ({
  id, projectId: "proj_1", title: id, messages: [],
} as unknown as ChatThreadDTO);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ activity: [] }) }));
  deleteThreadMock.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  rail.onDeleteThread = null;
  dialog.confirm = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mountAt(url: string, over: Partial<OttoAppProps>) {
  window.history.replaceState(null, "", url);
  const props = {
    projectId: "proj_1",
    projects: [{ id: "proj_1", name: "Test project" }],
    activeProjectId: "proj_1",
    sidebarThreads: [],
    entities: [], balanceUsd: 0, userName: "founder", memory: [], records: [],
    ads: [], adJobs: [], account: null, analytics: { state: "notConnected" },
    ...over,
  } as OttoAppProps;

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(OttoApp, props) as ReactElement));
}

async function deleteThread(id: string) {
  await act(async () => rail.onDeleteThread!(id)); // menu → "Delete conversation"
  await act(async () => { await dialog.confirm!(); }); // dialog → confirm
}

describe("#969 P2-5 — deleting a conversation must not yank the merchant off their screen", () => {
  it("keeps ?view=library in the address it replaces with", async () => {
    await mountAt("/otto?project=proj_1&view=library", {
      initialView: "library",
      threads: [thread("thread_a"), thread("thread_b")],
      sidebarThreads: [thread("thread_a"), thread("thread_b")],
      initialActiveThreadId: "thread_a",
    });

    await deleteThread("thread_a");

    // the regression: "/otto?project=proj_1&thread=thread_b" — no view → back to chat
    expect(routerReplace).toHaveBeenCalledWith("/otto?project=proj_1&thread=thread_b&view=library");
  });

  it("does the same from Analytics", async () => {
    await mountAt("/otto?project=proj_1&view=analytics", {
      initialView: "analytics",
      threads: [thread("thread_a"), thread("thread_b")],
      sidebarThreads: [thread("thread_a"), thread("thread_b")],
      initialActiveThreadId: "thread_a",
    });

    await deleteThread("thread_a");

    expect(routerReplace).toHaveBeenCalledWith("/otto?project=proj_1&thread=thread_b&view=analytics");
  });

  it("names no view from the conversation screen itself — that address is unchanged", async () => {
    await mountAt("/otto?project=proj_1&thread=thread_a", {
      threads: [thread("thread_a"), thread("thread_b")],
      sidebarThreads: [thread("thread_a"), thread("thread_b")],
      initialActiveThreadId: "thread_a",
    });

    await deleteThread("thread_a");

    expect(routerReplace).toHaveBeenCalledWith("/otto?project=proj_1&thread=thread_b");
  });

  it("goes back to the conversation when the LAST one is deleted — the state does too", async () => {
    // handleDeleteThread already forces view="otto" when nothing is left; the URL must agree,
    // or the URL→state follower would immediately push the screen back to Library.
    await mountAt("/otto?project=proj_1&view=library", {
      initialView: "library",
      threads: [thread("thread_a")],
      sidebarThreads: [thread("thread_a")],
      initialActiveThreadId: "thread_a",
    });

    await deleteThread("thread_a");

    expect(routerReplace).toHaveBeenCalledWith("/otto?project=proj_1");
  });

  it("does not touch the address when the deleted conversation was not the open one", async () => {
    await mountAt("/otto?project=proj_1&view=library", {
      initialView: "library",
      threads: [thread("thread_a"), thread("thread_b")],
      sidebarThreads: [thread("thread_a"), thread("thread_b")],
      initialActiveThreadId: "thread_a",
    });

    await deleteThread("thread_b");

    expect(routerReplace).not.toHaveBeenCalled();
  });
});
