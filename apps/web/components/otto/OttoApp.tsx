"use client";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createProject, renameProject, deleteProject, autoTitleProjectIfDefault } from "@/lib/actions";
import { listProjectThreadActivity } from "@/lib/thread-activity";
import { OttoNav } from "./OttoNav";
import { OttoView } from "./OttoView";
import type { AdTile } from "./OttoStuff";
import type { AdJobItem } from "@/lib/data";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import type { MemoryRow } from "@/lib/memory-actions";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { AccountInfo } from "@/lib/account-actions";
import type { AnalyticsData } from "@/lib/analytics-actions";
import type { HistoryThumb } from "@/lib/data";
import { getMyAccount } from "@/lib/account-actions";
import { deleteCoworkThread } from "@/lib/otto-client-actions";
import { nextActiveThreadId } from "@/lib/thread-list";

const MOBILE_BP = 680;

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="3" x2="21" y1="6" y2="6" />
      <line x1="3" x2="21" y1="12" y2="12" />
      <line x1="3" x2="21" y1="18" y2="18" />
    </svg>
  );
}

export type ProjectMeta = { id: string; name: string };

export interface OttoAppProps {
  projectId: string;
  /** All of the owner's projects (campaigns) for the Grok-style sidebar. */
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
  /** Spendable balance in DISPLAYED credits — shown in the nav (product uses credits, not $). */
  balanceCredits: number;
  userName: string;
  userEmail: string;
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
}

export type OttoViewKey = "otto" | "stuff" | "library" | "templates" | "discover" | "memory" | "account" | "connections" | "schedule" | "analytics";

const OTTO_VIEW_KEYS = new Set<OttoViewKey>(["otto", "stuff", "library", "templates", "discover", "memory", "account", "connections", "schedule", "analytics"]);

function parseViewParam(raw: string | null): OttoViewKey {
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
  balanceCredits: initialBalanceCredits,
  userName,
  userEmail,
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
}: OttoAppProps) {
  const router = useRouter();
  const [view, setView] = useState<OttoViewKey>(initialView ?? "otto");
  const [threads, setThreads] = useState<ChatThreadDTO[]>(initialThreads);
  const [sidebarThreadList, setSidebarThreadList] = useState<ChatThreadDTO[]>(sidebarThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId ?? initialThreads[0]?.id ?? null,
  );
  const [balanceCredits, setBalanceCredits] = useState(initialBalanceCredits);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activity, setActivity] = useState<Set<string>>(new Set());
  const [seedText, setSeedText] = useState<string>("");
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed ?? false);
  const [chatCollapsed, setChatCollapsed] = useState(initialChatCollapsed ?? false);
  const [actionError, setActionError] = useState<string | null>(null);
  // ── Multi-project (campaign = project) navigation ──
  const curProjectId = activeProjectId ?? projectId;

  useEffect(() => {
    function syncViewFromLocation() {
      setView(parseViewParam(new URLSearchParams(window.location.search).get("view")));
      setActionError(null);
    }
    window.addEventListener("popstate", syncViewFromLocation);
    return () => window.removeEventListener("popstate", syncViewFromLocation);
  }, []);

  useEffect(() => {
    setThreads((prev) => {
      if (!activeThreadId || initialThreads.some((t) => t.id === activeThreadId)) return initialThreads;
      const active = prev.find((t) => t.id === activeThreadId && t.projectId === curProjectId);
      return active ? [active, ...initialThreads] : initialThreads;
    });
  }, [activeThreadId, curProjectId, initialThreads]);

  useEffect(() => {
    setSidebarThreadList((prev) => {
      if (!activeThreadId || sidebarThreads.some((t) => t.id === activeThreadId)) return sidebarThreads;
      const active = prev.find((t) => t.id === activeThreadId && t.projectId === curProjectId);
      return active ? [active, ...sidebarThreads] : sidebarThreads;
    });
  }, [activeThreadId, curProjectId, sidebarThreads]);

  const applyActivity = useCallback((rows: Array<{ threadId: string; pending: boolean }>) => {
    setActivity(new Set(rows.filter((r) => r.pending).map((r) => r.threadId)));
  }, []);

  const refreshActivity = useCallback(async () => {
    const res = await listProjectThreadActivity(projectId);
    if (Array.isArray(res)) applyActivity(res);
  }, [projectId, applyActivity]);

  useEffect(() => {
    if (view !== "otto") return;
    let alive = true;
    async function poll() {
      const res = await listProjectThreadActivity(projectId);
      if (alive && Array.isArray(res)) {
        applyActivity(res);
      }
    }
    poll();
    const h = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(h); };
  }, [view, projectId, threads.length, applyActivity]);

  const refreshBalance = useCallback(async () => {
    const a = await getMyAccount();
    if (a && !("error" in a)) setBalanceCredits(a.balance);
  }, []);

  const projectHref = useCallback((projId: string, threadId?: string) => {
    const p = new URLSearchParams();
    p.set("project", projId);
    if (threadId) p.set("thread", threadId);
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
    // Mirror the active project's thread list immediately so campaign history
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
    pushLocalRoute(projectHref(thread.projectId || curProjectId, thread.id));
  }, [curProjectId, handleThreadsChange, projectHref, pushLocalRoute, threads]);

  const handleNewCampaign = useCallback(async () => {
    setActionError(null);
    const loginHref = `/login?from=${encodeURIComponent(projectHref(curProjectId))}`;
    try {
      const res = await createProject("New campaign");
      if (res && "id" in res) {
        router.push(projectHref(res.id));
        return;
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
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/unexpected response|not authorized|not authenticated|session/i.test(message)) {
        setActionError("Your session expired. Sign in again to continue.");
        window.location.assign(loginHref);
        return;
      }
      console.error("[handleNewCampaign] failed:", e);
      setActionError("Could not create a campaign. Refresh and try again.");
    }
  }, [router, projectHref, curProjectId]);

  // Switch to another project (optionally opening a specific thread). Same-project
  // thread clicks are handled by state (snappy); cross-project goes through here.
  const handleSwitchProject = useCallback((projId: string, threadId?: string) => {
    if (projId === curProjectId && !threadId) return;
    setActionError(null);
    router.push(projectHref(projId, threadId));
  }, [router, projectHref, curProjectId]);

  const handleSelectThread = useCallback((threadId: string) => {
    setActionError(null);
    setActiveThreadId(threadId);
    setView("otto");
    router.push(projectHref(curProjectId, threadId));
  }, [router, projectHref, curProjectId]);

  const handleRenameProject = useCallback(async (projId: string, name: string) => {
    const res = await renameProject(projId, name);
    if (res && "ok" in res) router.refresh();
  }, [router]);

  const handleDeleteProject = useCallback(async (projId: string) => {
    if (!window.confirm("Delete this campaign? It will be hidden from your sidebar.")) return;
    const res = await deleteProject(projId);
    if (!(res && "ok" in res)) return;
    // If the open project was deleted, move to another one (or the front door).
    if (projId === curProjectId) {
      const next = projects.find((p) => p.id !== projId);
      if (next) router.push(projectHref(next.id));
      else router.refresh();
    } else {
      router.refresh();
    }
  }, [router, projectHref, curProjectId, projects]);

  // Auto-title a still-default campaign from its first conversation (Grok pattern).
  // Runs once when the open project is unnamed but already has a titled thread.
  // Money-safe: the action writes only the project name, never any spend path.
  const autoTitledRef = useRef(false);
  useEffect(() => {
    if (autoTitledRef.current) return;
    const active = projects.find((p) => p.id === curProjectId);
    if (!active || (active.name !== "New campaign" && active.name !== "Untitled Project")) return;
    const named = sidebarThreadList.some(
      (t) => t.projectId === curProjectId && t.title && t.title !== "New campaign" && t.title !== "Untitled",
    );
    if (!named) return;
    autoTitledRef.current = true;
    void autoTitleProjectIfDefault(curProjectId).then((res) => {
      if (res && "name" in res && res.name) router.refresh();
    });
  }, [projects, curProjectId, sidebarThreadList, router]);

  async function handleDeleteThread(id: string) {
    const snapshot = threads;
    const snapshotActive = activeThreadId;
    // Optimistic removal
    handleThreadsChange(threads.filter((t) => t.id !== id));
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
      setActiveThreadId(snapshotActive);
      return;
    }
    if (snapshotActive === id) {
      router.replace(projectHref(curProjectId, newActive ?? undefined));
    }
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
        }
        @media (min-width: ${MOBILE_BP + 1}px) {
          .otto-mobile-topbar { display: none !important; }
        }
      `}</style>

      {/* Show-sidebar button — visible only while the nav is collapsed */}
      {navCollapsed && (
        <button
          type="button"
          onClick={() => setNavCollapsed(false)}
          title="Show sidebar"
          aria-label="Show sidebar"
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
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onNewCampaign={handleNewCampaign}
        onDeleteThread={handleDeleteThread}
        balanceCredits={balanceCredits}
        userName={userName}
        userEmail={userEmail}
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
          onDeleteThread={handleDeleteThread}
          onNewConvo={() => setActiveThreadId(null)}
          seedText={seedText}
          onSeedConsumed={() => setSeedText("")}
          onUseInOtto={handleUseInOtto}
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

    </div>
  );
}

export default OttoApp;
