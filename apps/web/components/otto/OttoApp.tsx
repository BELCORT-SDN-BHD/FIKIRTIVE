"use client";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createProject, renameProject, deleteProject, autoTitleProjectIfDefault, setProjectPinned } from "@/lib/actions";
import { OttoNav } from "./OttoNav";
import { OttoView } from "./OttoView";
import { OttoConfirmDialog, OttoRenameDialog } from "./OttoPromptDialog";
import type { AdTile } from "./OttoStuff";
import type { AdJobItem } from "@/lib/data";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import type { MemoryRow } from "@/lib/memory-actions";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { AccountInfo } from "@/lib/account-actions";
import type { AnalyticsData } from "@/lib/analytics-actions";
import type { HistoryThumb } from "@/lib/data";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { deleteCoworkThread, renameCoworkThread, setCoworkThreadPinned } from "@/lib/otto-client-actions";
import { setOwnerSetting } from "@/lib/owner-settings-actions";
import { nextActiveThreadId } from "@/lib/thread-list";

const MOBILE_BP = 680;
const STALE_ACTION_RELOAD_KEY = "fikirtive:stale-server-action-reload-at";

type ThreadActivityRow = { threadId: string; pending: boolean };

function isThreadActivityRows(value: unknown): value is ThreadActivityRow[] {
  return Array.isArray(value)
    && value.every((row) => (
      row
      && typeof row === "object"
      && typeof (row as ThreadActivityRow).threadId === "string"
      && typeof (row as ThreadActivityRow).pending === "boolean"
    ));
}

function errorText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as { message?: unknown; reason?: unknown };
    if (typeof record.message === "string") return record.message;
    if (typeof record.reason === "string") return record.reason;
  }
  return "";
}

function isStaleServerActionError(value: unknown): boolean {
  return /failed to find server action|server action .*not found|unexpected response was received from the server/i.test(errorText(value));
}

function reloadOnceForFreshDeploy(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const last = Number(window.sessionStorage.getItem(STALE_ACTION_RELOAD_KEY) ?? "0");
  if (Number.isFinite(last) && now - last < 60_000) return;
  window.sessionStorage.setItem(STALE_ACTION_RELOAD_KEY, String(now));
  window.location.reload();
}

async function fetchProjectThreadActivity(projectId: string): Promise<ThreadActivityRow[] | { error: string }> {
  try {
    const res = await fetch(`/api/otto/thread-activity?projectId=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await res.json().catch(() => null) as { activity?: unknown; error?: unknown } | null;
    if (!res.ok) {
      return { error: typeof body?.error === "string" ? body.error : "Could not refresh activity." };
    }
    if (isThreadActivityRows(body?.activity)) return body.activity;
    return { error: "Could not refresh activity." };
  } catch (e) {
    if (isStaleServerActionError(e)) reloadOnceForFreshDeploy();
    return { error: "Could not refresh activity." };
  }
}

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="3" x2="21" y1="6" y2="6" />
      <line x1="3" x2="21" y1="12" y2="12" />
      <line x1="3" x2="21" y1="18" y2="18" />
    </svg>
  );
}

export type ProjectMeta = { id: string; name: string; pinnedAt?: string | null };

export interface OttoAppProps {
  projectId: string;
  /** All of the owner's projects for the Grok-style sidebar. */
  projects?: ProjectMeta[];
  /** The currently-open project (= projectId; explicit for nav highlighting). */
  activeProjectId?: string;
  /** Conversation metas across ALL projects — the sidebar nests these under their project. */
  sidebarThreads?: ChatThreadDTO[];
  /** Which thread to open on load (?thread=, falls back to most recent). */
  initialActiveThreadId?: string | null;
  entities: EntityDTO[];
  threads: ChatThreadDTO[];
  balanceUsd: number;
  userName: string;
  memory: MemoryRow[];
  records: BrandRecordRow[];
  ads: AdTile[];
  adJobs: AdJobItem[];
  account: AccountInfo | null;
  /** Analytics view payload — threaded to OttoView's Analytics branch (server-fetched in Task 5). */
  analytics: AnalyticsData;
  /** Recent generation thumbnails for the sidebar History strip (display-only). */
  history?: HistoryThumb[];
  ottoStreamEnabled: boolean;
  initialView?: OttoViewKey;
  /** Re-skin flag (?skin=gb): opt into the Grok-bright look (strangler). */
  skin?: "gb";
  /** Start with a pane collapsed (the canvas home's panes are collapsible). */
  initialNavCollapsed?: boolean;
  initialChatCollapsed?: boolean;
  /** #679 — has this WORKSPACE dismissed the "Get Otto ready" card? Read server-side from the
   *  org row, so a new device or a private window gets the same answer. */
  onboardingDismissed?: boolean;
}

export type OttoViewKey = "otto" | "stuff" | "library" | "templates" | "discover" | "memory" | "account" | "connections" | "schedule" | "analytics";

const OTTO_VIEW_KEYS = new Set<OttoViewKey>(["otto", "stuff", "library", "templates", "discover", "memory", "account", "connections", "schedule", "analytics"]);

function parseViewParam(raw: string | null): OttoViewKey {
  if (raw === "stuff") return "library";
  return raw && OTTO_VIEW_KEYS.has(raw as OttoViewKey) ? (raw as OttoViewKey) : "otto";
}

export function OttoApp({
  projectId,
  projects = [],
  activeProjectId,
  sidebarThreads = [],
  initialActiveThreadId,
  entities,
  threads: initialThreads,
  balanceUsd,
  userName,
  memory,
  records,
  ads,
  adJobs,
  account,
  analytics,
  history,
  ottoStreamEnabled,
  initialView,
  skin,
  initialNavCollapsed,
  initialChatCollapsed,
  onboardingDismissed = false,
}: OttoAppProps) {
  const router = useRouter();
  const [view, setView] = useState<OttoViewKey>(initialView ?? "otto");
  const [threads, setThreads] = useState<ChatThreadDTO[]>(initialThreads);
  const [sidebarThreadList, setSidebarThreadList] = useState<ChatThreadDTO[]>(sidebarThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId === undefined ? (initialThreads[0]?.id ?? null) : initialActiveThreadId,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  // #679 — mirrored so the card closes on the click, not a round-trip later. The row is the
  // authority: a reload (or any other device) reads the server value again.
  const [onboardingHidden, setOnboardingHidden] = useState(onboardingDismissed);
  const [activity, setActivity] = useState<Set<string>>(new Set());
  const [seedText, setSeedText] = useState<string>("");
  // #513 A组返工 item 1 — closed by default: OttoNav is a slide-over now (see
  // OttoNav.tsx), so the project/tools rail must not appear unprompted next to
  // the persistent global nav. The floating "Show sidebar" button below opens it.
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed ?? true);
  const [chatCollapsed, setChatCollapsed] = useState(initialChatCollapsed ?? false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newProjectPending, setNewProjectPending] = useState(false);
  const [renameProjectTarget, setRenameProjectTarget] = useState<ProjectMeta | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectMeta | null>(null);
  const [renameThreadTarget, setRenameThreadTarget] = useState<ChatThreadDTO | null>(null);
  const [deleteThreadTarget, setDeleteThreadTarget] = useState<ChatThreadDTO | null>(null);
  const newProjectPendingRef = useRef(false);
  // ── Multi-project navigation ──
  const curProjectId = activeProjectId ?? projectId;

  useEffect(() => {
    function onError(event: ErrorEvent) {
      if (isStaleServerActionError(event.error ?? event.message)) reloadOnceForFreshDeploy();
    }
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isStaleServerActionError(event.reason)) reloadOnceForFreshDeploy();
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    function syncFromLocation() {
      const params = new URLSearchParams(window.location.search);
      const nextView = parseViewParam(params.get("view"));
      setView(nextView);
      setActionError(null);
      // The "otto" view's URL always fully encodes the active thread (see projectHref /
      // viewHref below) — including handleThreadStarted and handleNewChat's same-project
      // branch, which push their URL via raw history.pushState with no Next.js navigation,
      // to avoid remounting the stream mid-turn. Restore activeThreadId from that URL on
      // Back/Forward so the SPA doesn't keep showing a thread the address bar no longer
      // names. Non-"otto" views never touch activeThreadId when pushed, so leave it alone.
      //
      // A bare "otto" URL with neither ?thread= nor ?new=1 (e.g. handleUseInOtto's push,
      // or landing straight on /otto?project=P) carries no explicit thread/new signal —
      // mirror the server's own default for that exact address (app/otto/page.tsx: no
      // thread + no new=1 opens the most recent thread), so Back/Forward never disagrees
      // with what reloading the same URL would show.
      if (nextView === "otto") {
        const threadParam = params.get("thread");
        if (threadParam) {
          setActiveThreadId(threadParam);
        } else if (params.get("new") === "1") {
          setActiveThreadId(null);
        } else {
          setActiveThreadId(threads[0]?.id ?? null);
        }
      }
    }
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [threads]);

  useEffect(() => {
    queueMicrotask(() => {
      setThreads((prev) => {
        if (!activeThreadId || initialThreads.some((t) => t.id === activeThreadId)) return initialThreads;
        const active = prev.find((t) => t.id === activeThreadId && t.projectId === curProjectId);
        return active ? [active, ...initialThreads] : initialThreads;
      });
    });
  }, [activeThreadId, curProjectId, initialThreads]);

  useEffect(() => {
    queueMicrotask(() => {
      setSidebarThreadList((prev) => {
        if (!activeThreadId || sidebarThreads.some((t) => t.id === activeThreadId)) return sidebarThreads;
        const active = prev.find((t) => t.id === activeThreadId && t.projectId === curProjectId);
        return active ? [active, ...sidebarThreads] : sidebarThreads;
      });
    });
  }, [activeThreadId, curProjectId, sidebarThreads]);

  const applyActivity = useCallback((rows: Array<{ threadId: string; pending: boolean }>) => {
    setActivity(new Set(rows.filter((r) => r.pending).map((r) => r.threadId)));
  }, []);

  const refreshActivity = useCallback(async () => {
    const res = await fetchProjectThreadActivity(projectId);
    if (Array.isArray(res)) applyActivity(res);
  }, [projectId, applyActivity]);

  useEffect(() => {
    if (view !== "otto") return;
    let alive = true;
    async function poll() {
      const res = await fetchProjectThreadActivity(projectId);
      if (alive && Array.isArray(res)) {
        applyActivity(res);
      }
    }
    poll();
    const h = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(h); };
  }, [view, projectId, threads.length, applyActivity]);

  // Every settle in this tree (canvas generations, Otto turns, plan/pack/research cards)
  // funnels into here via onBalanceRefresh. Its only job is to announce: the persistent
  // global nav owns the credits figure and does the read itself.
  //
  // Deliberately nothing but the announcement (round-1 review P1②/P2①). This used to
  // await its own account read first, to keep a local credits figure that nothing has
  // rendered since #513 A组 moved credits into the global nav — which both doubled every
  // fetch and let a failing read swallow the whole event before it was ever published.
  const refreshBalance = useCallback(async () => {
    notifyBalanceRefresh();
  }, []);

  const projectHref = useCallback((projId: string, threadId?: string, opts?: { newChat?: boolean }) => {
    const p = new URLSearchParams();
    p.set("project", projId);
    if (threadId) p.set("thread", threadId);
    if (opts?.newChat && !threadId) p.set("new", "1");
    // gb is the default now — no ?skin needed in the URL.
    return `/otto?${p.toString()}`;
  }, []);

  const pushLocalRoute = useCallback((href: string) => {
    if (typeof window !== "undefined") {
      const current = `${window.location.pathname}${window.location.search}`;
      if (current !== href) window.history.pushState(null, "", href);
    }
    router.replace(href);
  }, [router]);

  const pushViewHistory = useCallback((href: string) => {
    if (typeof window === "undefined") return;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== href) window.history.pushState(null, "", href);
  }, []);

  const viewHref = useCallback((nextView: OttoViewKey) => {
    const p = new URLSearchParams();
    p.set("project", curProjectId);
    if (nextView !== "otto") {
      p.set("view", nextView);
    } else if (activeThreadId) {
      p.set("thread", activeThreadId);
    }
    return `/otto?${p.toString()}`;
  }, [activeThreadId, curProjectId]);

  const handleViewChange = useCallback((nextView: OttoViewKey) => {
    setActionError(null);
    setView(nextView);
    pushViewHistory(viewHref(nextView));
  }, [pushViewHistory, viewHref]);

  // #679 — dismissing the getting-started card is a fact about the shop, so it is written to
  // the shop's row. The click hides the card immediately; if the write is refused (the only
  // refusals are "not signed in" and "staff are impersonating you") the card comes back on the
  // next load, which is honest — nothing was recorded.
  const handleDismissOnboarding = useCallback(() => {
    setOnboardingHidden(true);
    void setOwnerSetting("ottoOnboardingDismissed", true).catch(() => {});
  }, []);

  function handleUseInOtto(prompt: string) {
    setSeedText(prompt);
    setActiveThreadId(null);
    setActionError(null);
    setView("otto");
    pushViewHistory(projectHref(curProjectId));
  }

  const handleThreadsChange = useCallback((next: ChatThreadDTO[]) => {
    setThreads(next);
    // The sidebar receives all-project thread metas from the server, but a new
    // front-door thread is created client-side before the next server refresh.
    // Mirror the active project's thread list immediately so project history
    // does not look empty until reload.
    setSidebarThreadList((prev) => [
      ...next,
      ...prev.filter((t) => t.projectId !== curProjectId),
    ]);
  }, [curProjectId]);

  const handleThreadStarted = useCallback((thread: ChatThreadDTO) => {
    handleThreadsChange([thread, ...threads.filter((t) => t.id !== thread.id)]);
    setActiveThreadId(thread.id);
    setView("otto");
    // State already owns this same-project transition. Keep the URL in sync without
    // starting an RSC replacement that can remount the just-opened stream against the
    // empty thread shell before its durable first turn lands.
    pushViewHistory(projectHref(thread.projectId || curProjectId, thread.id));
  }, [curProjectId, handleThreadsChange, projectHref, pushViewHistory, threads]);

  const handleNewProject = useCallback(async () => {
    if (newProjectPendingRef.current) return false;
    newProjectPendingRef.current = true;
    setNewProjectPending(true);
    setActionError(null);
    const loginHref = `/login?from=${encodeURIComponent(projectHref(curProjectId))}`;
    try {
      // #546: the entry builds a Project and says so — "New campaign" was the literal
      // DB name merchants then hunted for on /campaign (which lists Campaign rows only).
      const res = await createProject("New project");
      if (res && "id" in res) {
        window.location.assign(projectHref(res.id));
        return true;
      }
      if (res && "error" in res) {
        const message = res.error;
        if (/not authorized|not authenticated/i.test(message)) {
          setActionError("Your session expired. Sign in again to continue.");
          window.location.assign(loginHref);
        } else {
          setActionError(message);
        }
      }
      return false;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/unexpected response|not authorized|not authenticated|session/i.test(message)) {
        setActionError("Your session expired. Sign in again to continue.");
        window.location.assign(loginHref);
        return false;
      }
      console.error("[handleNewProject] failed:", e);
      setActionError("Could not create a project. Refresh and try again.");
      return false;
    } finally {
      newProjectPendingRef.current = false;
      setNewProjectPending(false);
    }
  }, [projectHref, curProjectId]);

  // Switch to another project (optionally opening a specific thread). Same-project
  // thread clicks are handled by state (snappy); cross-project goes through here.
  const handleSwitchProject = useCallback((projId: string, threadId?: string) => {
    if (projId === curProjectId && !threadId) return;
    setActionError(null);
    router.push(projectHref(projId, threadId));
  }, [router, projectHref, curProjectId]);

  const handleNewChat = useCallback((projId: string) => {
    setActionError(null);
    if (projId === curProjectId) {
      setActiveThreadId(null);
      setView("otto");
      pushLocalRoute(projectHref(projId, undefined, { newChat: true }));
      return;
    }
    router.push(projectHref(projId, undefined, { newChat: true }));
  }, [curProjectId, projectHref, pushLocalRoute, router]);

  const handleSelectThread = useCallback((threadId: string, threadProjectId = curProjectId) => {
    setActionError(null);
    if (threadProjectId !== curProjectId) {
      router.push(projectHref(threadProjectId, threadId));
      return;
    }
    setActiveThreadId(threadId);
    setView("otto");
    router.push(projectHref(curProjectId, threadId));
  }, [router, projectHref, curProjectId]);

  const handleRenameProject = useCallback(async (projId: string, name: string) => {
    const res = await renameProject(projId, name);
    if (res && "ok" in res) router.refresh();
    else if (res && "error" in res) setActionError(res.error);
  }, [router]);

  const handleDeleteProject = useCallback(async (projId: string) => {
    const res = await deleteProject(projId);
    if (!(res && "ok" in res)) {
      if (res && "error" in res) setActionError(res.error);
      return;
    }
    // If the open project was deleted, move to another one (or the front door).
    if (projId === curProjectId) {
      const next = projects.find((p) => p.id !== projId);
      if (next) router.push(projectHref(next.id));
      else router.refresh();
    } else {
      router.refresh();
    }
  }, [router, projectHref, curProjectId, projects]);

  const requestRenameProject = useCallback((projId: string) => {
    const target = projects.find((p) => p.id === projId);
    if (target) setRenameProjectTarget(target);
  }, [projects]);

  const requestDeleteProject = useCallback((projId: string) => {
    const target = projects.find((p) => p.id === projId);
    if (target) setDeleteProjectTarget(target);
  }, [projects]);

  const handleSetProjectPinned = useCallback(async (projId: string, pinned: boolean) => {
    const res = await setProjectPinned(projId, pinned);
    if (res && "ok" in res) router.refresh();
    else if (res && "error" in res) setActionError(res.error);
  }, [router]);

  // Auto-title a still-default project from its first conversation (Grok pattern).
  // Runs once when the open project is unnamed but already has a titled thread.
  // Money-safe: the action writes only the project name, never any spend path.
  // ("New campaign" stays matched so pre-#546 DB rows keep auto-titling.)
  const autoTitledRef = useRef(false);
  useEffect(() => {
    if (autoTitledRef.current) return;
    const active = projects.find((p) => p.id === curProjectId);
    if (!active || (active.name !== "New project" && active.name !== "New campaign" && active.name !== "Untitled Project")) return;
    const named = sidebarThreadList.some(
      (t) => t.projectId === curProjectId && t.title && t.title !== "New campaign" && t.title !== "Untitled",
    );
    if (!named) return;
    autoTitledRef.current = true;
    void autoTitleProjectIfDefault(curProjectId).then((res) => {
      if (res && "name" in res && res.name) router.refresh();
    });
  }, [projects, curProjectId, sidebarThreadList, router]);

  async function handleRenameThread(id: string, title: string) {
    const clean = title.trim();
    if (!clean) return;
    const snapshot = threads;
    const sidebarSnapshot = sidebarThreadList;
    const applyTitle = (items: ChatThreadDTO[]) => items.map((t) => (t.id === id ? { ...t, title: clean } : t));
    setThreads(applyTitle);
    setSidebarThreadList(applyTitle);
    const result = await renameCoworkThread(id, clean);
    if ("error" in result) {
      console.error("[handleRenameThread] failed:", result.error);
      setThreads(snapshot);
      setSidebarThreadList(sidebarSnapshot);
      setActionError(result.error);
    }
  }

  async function handleSetThreadPinned(id: string, pinned: boolean) {
    const snapshot = threads;
    const sidebarSnapshot = sidebarThreadList;
    const pinnedAt = pinned ? new Date().toISOString() : null;
    const applyPin = (items: ChatThreadDTO[]) => items.map((t) => (t.id === id ? { ...t, pinnedAt } : t));
    setThreads(applyPin);
    setSidebarThreadList(applyPin);
    const result = await setCoworkThreadPinned(id, pinned);
    if ("error" in result) {
      console.error("[handleSetThreadPinned] failed:", result.error);
      setThreads(snapshot);
      setSidebarThreadList(sidebarSnapshot);
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDeleteThread(id: string) {
    const snapshot = threads;
    const sidebarSnapshot = sidebarThreadList;
    const snapshotActive = activeThreadId;
    // Optimistic removal
    handleThreadsChange(threads.filter((t) => t.id !== id));
    setSidebarThreadList((prev) => prev.filter((t) => t.id !== id));
    const newActive = nextActiveThreadId(threads, id, activeThreadId);
    if (activeThreadId === id) {
      setActiveThreadId(newActive);
      if (newActive === null) setView("otto");
    }
    const result = await deleteCoworkThread(id);
    if ("error" in result) {
      // Restore on failure
      console.error("[handleDeleteThread] failed:", result.error);
      handleThreadsChange(snapshot);
      setSidebarThreadList(sidebarSnapshot);
      setActiveThreadId(snapshotActive);
      setActionError(result.error);
      return;
    }
    if (snapshotActive === id) {
      router.replace(projectHref(curProjectId, newActive ?? undefined));
    }
  }

  function requestRenameThread(id: string) {
    const target = sidebarThreadList.find((t) => t.id === id) ?? threads.find((t) => t.id === id);
    if (target) setRenameThreadTarget(target);
  }

  function requestDeleteThread(id: string) {
    const target = sidebarThreadList.find((t) => t.id === id) ?? threads.find((t) => t.id === id);
    if (target) setDeleteThreadTarget(target);
  }

  return (
    <div
      className="gb"
      style={{
        position: "relative",
        display: "flex",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--background)",
      }}
    >
      <style>{`
        @media (max-width: ${MOBILE_BP}px) {
          .otto-mobile-topbar { display: flex !important; }
          /* The mobile hamburger above already opens the same rail — the floating
             desktop toggle would otherwise double up with it. */
          .otto-show-sidebar-btn { display: none !important; }
        }
        @media (min-width: ${MOBILE_BP + 1}px) {
          .otto-mobile-topbar { display: none !important; }
        }
      `}</style>

      {/* Show-sidebar button — visible only while the nav is collapsed (desktop only;
          mobile already has the hamburger above for the same rail). */}
      {navCollapsed && (
        <button
          type="button"
          onClick={() => setNavCollapsed(false)}
          title="Show sidebar"
          aria-label="Show sidebar"
          className="otto-show-sidebar-btn"
          style={{
            position: "absolute",
            top: "0.75rem",
            left: "0.75rem",
            zIndex: 50,
            width: 34,
            height: 34,
            borderRadius: "10px",
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--muted-foreground)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m13 9 3 3-3 3" />
          </svg>
        </button>
      )}

      {/* Left nav */}
      <OttoNav
        collapsed={navCollapsed}
        onToggleCollapse={() => setNavCollapsed((v) => !v)}
        view={view}
        onViewChange={handleViewChange}
        projects={projects}
        activeProjectId={curProjectId}
        sidebarThreads={sidebarThreadList}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onSwitchProject={handleSwitchProject}
        onNewChat={handleNewChat}
        onRenameProject={requestRenameProject}
        onSetProjectPinned={handleSetProjectPinned}
        onDeleteProject={requestDeleteProject}
        onNewProject={handleNewProject}
        newProjectPending={newProjectPending}
        onRenameThread={requestRenameThread}
        onSetThreadPinned={handleSetThreadPinned}
        onDeleteThread={requestDeleteThread}
        history={history}
        drawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
      />

      {/* Main content area */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Mobile top bar — hamburger + logo. Hidden on desktop via CSS. */}
        <div
          className="otto-mobile-topbar"
          style={{
            display: "none",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0 1rem",
            height: 52,
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
            background: "var(--card)",
          }}
        >
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              border: "none",
              background: "transparent",
              color: "var(--foreground)",
              cursor: "pointer",
              borderRadius: "14px",
              flexShrink: 0,
            }}
          >
            <IconMenu />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-wordmark.svg" alt="Fikirtive" height={22} style={{ display: "block" }} />
        </div>
        <OttoView
          view={view}
          projectId={projectId}
          entities={entities}
          threads={threads}
          activeThreadId={activeThreadId}
          onThreadsChange={handleThreadsChange}
          onActiveThreadChange={setActiveThreadId}
          onThreadStarted={handleThreadStarted}
          balanceUsd={balanceUsd}
          userName={userName}
          memory={memory}
          records={records}
          ads={ads}
          adJobs={adJobs}
          history={history ?? []}
          account={account}
          analytics={analytics}
          ottoStreamEnabled={ottoStreamEnabled}
          onBalanceRefresh={refreshBalance}
          onViewChange={handleViewChange}
          onOpenThread={handleSelectThread}
          activity={activity}
          onActivityRefresh={refreshActivity}
          onDeleteThread={requestDeleteThread}
          onNewConvo={() => handleNewChat(curProjectId)}
          seedText={seedText}
          onSeedConsumed={() => setSeedText("")}
          onUseInOtto={handleUseInOtto}
          onboardingDismissed={onboardingHidden}
          onDismissOnboarding={handleDismissOnboarding}
          // Every conversation this SHOP has, across every project (the page loads them for the
          // sidebar) — not just the open project's. See OttoView for why the distinction matters.
          shopConversationCount={sidebarThreadList.length}
          chatCollapsed={chatCollapsed}
          onToggleChat={() => setChatCollapsed((v) => !v)}
          skin={skin}
        />
      </div>
      {actionError && (
        <div
          role="alert"
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 80,
            maxWidth: 460,
            padding: "0.875rem 1rem",
            borderRadius: 12,
            border: "1px solid rgba(220,38,38,0.32)",
            background: "var(--card)",
            color: "var(--foreground)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.875rem", lineHeight: 1.4 }}>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 9,
              background: "transparent",
              color: "var(--foreground)",
              padding: "0.35rem 0.55rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <OttoRenameDialog
        open={!!renameProjectTarget}
        onOpenChange={(open) => { if (!open) setRenameProjectTarget(null); }}
        title="Rename project"
        description="This only changes the sidebar name. Your chats, canvas, and assets stay where they are."
        label="Project name"
        initialValue={renameProjectTarget?.name ?? ""}
        onSubmit={async (name) => {
          if (!renameProjectTarget) return;
          await handleRenameProject(renameProjectTarget.id, name);
        }}
      />

      <OttoConfirmDialog
        open={!!deleteProjectTarget}
        onOpenChange={(open) => { if (!open) setDeleteProjectTarget(null); }}
        title="Permanently delete project?"
        description={deleteProjectTarget ? `Otto will delete "${deleteProjectTarget.name}" and its project-scoped work.` : ""}
        impacts={[
          "The project record is permanently deleted.",
          "Its chats, canvas nodes, jobs, and project media records are deleted.",
          "Global library assets and credit ledger rows are not deleted here.",
        ]}
        confirmText={deleteProjectTarget?.name}
        confirmLabel="Delete project"
        confirmingLabel="Deleting..."
        tone="danger"
        onConfirm={async () => {
          if (!deleteProjectTarget) return;
          await handleDeleteProject(deleteProjectTarget.id);
        }}
      />

      <OttoRenameDialog
        open={!!renameThreadTarget}
        onOpenChange={(open) => { if (!open) setRenameThreadTarget(null); }}
        title="Rename conversation"
        description="This only changes the label shown in the conversation history."
        label="Conversation name"
        initialValue={renameThreadTarget?.title ?? ""}
        onSubmit={async (title) => {
          if (!renameThreadTarget) return;
          await handleRenameThread(renameThreadTarget.id, title);
        }}
      />

      <OttoConfirmDialog
        open={!!deleteThreadTarget}
        onOpenChange={(open) => { if (!open) setDeleteThreadTarget(null); }}
        title="Permanently delete conversation?"
        description={deleteThreadTarget ? `Otto will delete "${deleteThreadTarget.title}" and its messages.` : ""}
        impacts={[
          "The conversation and its messages are permanently deleted.",
          "Canvas nodes and generated media are detached from this conversation.",
          "Generated library assets stay available.",
        ]}
        confirmText={deleteThreadTarget?.title}
        confirmLabel="Delete conversation"
        confirmingLabel="Deleting..."
        tone="danger"
        onConfirm={async () => {
          if (!deleteThreadTarget) return;
          await handleDeleteThread(deleteThreadTarget.id);
        }}
      />

    </div>
  );
}

export default OttoApp;
