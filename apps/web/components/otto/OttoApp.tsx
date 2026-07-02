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
import type { AccountInfo } from "@/lib/account-actions";
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
  ads: AdTile[];
  adJobs: AdJobItem[];
  account: AccountInfo | null;
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
  ads,
  adJobs,
  account,
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
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId ?? initialThreads[0]?.id ?? null,
  );
  const [balanceCredits, setBalanceCredits] = useState(initialBalanceCredits);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activity, setActivity] = useState<Set<string>>(new Set());
  const [seedText, setSeedText] = useState<string>("");
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed ?? false);
  const [chatCollapsed, setChatCollapsed] = useState(initialChatCollapsed ?? false);

  useEffect(() => {
    if (view !== "otto") return;
    let alive = true;
    async function poll() {
      const res = await listProjectThreadActivity(projectId);
      if (alive && Array.isArray(res)) {
        setActivity(new Set(res.filter((r) => r.pending).map((r) => r.threadId)));
      }
    }
    poll();
    const h = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(h); };
  }, [view, projectId, threads.length]);

  const refreshBalance = useCallback(async () => {
    const a = await getMyAccount();
    if (a && !("error" in a)) setBalanceCredits(a.balance);
  }, []);

  function handleUseInOtto(prompt: string) {
    setSeedText(prompt);
    setActiveThreadId(null);
    setView("otto");
  }

  // ── Multi-project (campaign = project) navigation ──
  const curProjectId = activeProjectId ?? projectId;
  const projectHref = useCallback((projId: string, threadId?: string) => {
    const p = new URLSearchParams();
    p.set("project", projId);
    if (threadId) p.set("thread", threadId);
    // gb is the default now — no ?skin needed in the URL.
    return `/otto?${p.toString()}`;
  }, []);

  const handleNewCampaign = useCallback(async () => {
    try {
      const res = await createProject("New campaign");
      if (res && "id" in res) router.push(projectHref(res.id));
    } catch (e) {
      console.error("[handleNewCampaign] failed:", e);
    }
  }, [router, projectHref]);

  // Switch to another project (optionally opening a specific thread). Same-project
  // thread clicks are handled by state (snappy); cross-project goes through here.
  const handleSwitchProject = useCallback((projId: string, threadId?: string) => {
    if (projId === curProjectId && !threadId) return;
    router.push(projectHref(projId, threadId));
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
    const named = sidebarThreads.some(
      (t) => t.projectId === curProjectId && t.title && t.title !== "New campaign" && t.title !== "Untitled",
    );
    if (!named) return;
    autoTitledRef.current = true;
    void autoTitleProjectIfDefault(curProjectId).then((res) => {
      if (res && "name" in res && res.name) router.refresh();
    });
  }, [projects, curProjectId, sidebarThreads, router]);

  async function handleDeleteThread(id: string) {
    const snapshot = threads;
    const snapshotActive = activeThreadId;
    // Optimistic removal
    setThreads((prev) => prev.filter((t) => t.id !== id));
    const newActive = nextActiveThreadId(threads, id, activeThreadId);
    if (activeThreadId === id) {
      setActiveThreadId(newActive);
      if (newActive === null) setView("otto");
    }
    const result = await deleteCoworkThread(id);
    if ("error" in result) {
      // Restore on failure
      console.error("[handleDeleteThread] failed:", result.error);
      setThreads(snapshot);
      setActiveThreadId(snapshotActive);
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
        onViewChange={setView}
        projects={projects}
        activeProjectId={curProjectId}
        sidebarThreads={sidebarThreads}
        activeThreadId={activeThreadId}
        onSelectThread={setActiveThreadId}
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
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
          onThreadsChange={setThreads}
          onActiveThreadChange={setActiveThreadId}
          balanceUsd={balanceUsd}
          userName={userName}
          memory={memory}
          ads={ads}
          adJobs={adJobs}
          account={account}
          ottoStreamEnabled={ottoStreamEnabled}
          onBalanceRefresh={refreshBalance}
          onViewChange={setView}
          activity={activity}
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

    </div>
  );
}

export default OttoApp;
