"use client";
import React, { useState, useCallback, useEffect } from "react";
import { listProjectThreadActivity } from "@/lib/thread-activity";
import "../../app/otto/otto-theme.css";
import { OttoNav } from "./OttoNav";
import { OttoView } from "./OttoView";
import type { AdTile } from "./OttoStuff";
import type { AdJobItem } from "@/lib/data";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import type { MemoryRow } from "@/lib/memory-actions";
import type { AccountInfo } from "@/lib/account-actions";
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

export interface OttoAppProps {
  projectId: string;
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
  ottoStreamEnabled: boolean;
}

export type OttoViewKey = "otto" | "stuff" | "library" | "templates" | "discover" | "memory" | "account";

export function OttoApp({
  projectId,
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
  ottoStreamEnabled,
}: OttoAppProps) {
  const [view, setView] = useState<OttoViewKey>("otto");
  const [threads, setThreads] = useState<ChatThreadDTO[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreads[0]?.id ?? null,
  );
  const [balanceCredits, setBalanceCredits] = useState(initialBalanceCredits);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activity, setActivity] = useState<Set<string>>(new Set());
  const [seedText, setSeedText] = useState<string>("");

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
      className="fk"
      style={{
        position: "relative",
        display: "flex",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--bg-page)",
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

      {/* Left nav */}
      <OttoNav
        view={view}
        onViewChange={setView}
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={setActiveThreadId}
        onNewCampaign={() => {
          setView("otto");
          setActiveThreadId(null);
        }}
        onDeleteThread={handleDeleteThread}
        balanceCredits={balanceCredits}
        userName={userName}
        userEmail={userEmail}
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
            gap: "var(--space-3)",
            padding: "0 var(--space-4)",
            height: 52,
            flexShrink: 0,
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--surface-card)",
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
              color: "var(--text-body)",
              cursor: "pointer",
              borderRadius: "var(--radius-md)",
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
          onUseInOtto={handleUseInOtto}
        />
      </div>

    </div>
  );
}

export default OttoApp;
