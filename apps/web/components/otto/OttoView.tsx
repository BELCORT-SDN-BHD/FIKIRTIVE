"use client";
import React, { useCallback, useMemo, useRef, useState } from "react";
import type { OttoViewKey } from "./OttoApp";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import type { MemoryRow } from "@/lib/memory-actions";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { AccountInfo } from "@/lib/account-actions";
import { buildStuffItems } from "@/lib/stuff-items";
import { OttoFrontDoor } from "./OttoFrontDoor";
import { OttoConversation } from "./OttoConversation";
import { OttoChatStream } from "./OttoChatStream";
import { OttoMemory } from "./OttoMemory";
import { OttoAccount } from "./OttoAccount";
import { OttoStuff, type AdTile } from "./OttoStuff";
import { OttoAnalytics } from "./OttoAnalytics";
import { OttoSchedule } from "./OttoSchedule";
import type { AnalyticsData } from "@/lib/analytics-actions";
import { OttoOnboarding } from "./OttoOnboarding";
import OttoTemplates from "./OttoTemplates";
import OttoDiscover from "./OttoDiscover";
import OttoConnections from "./OttoConnections";
import type { AdJobItem, HistoryThumb } from "@/lib/data";
import type { OttoComposerReference } from "@/lib/canvas-chat-reference";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import FlowCanvas from "../canvas/FlowCanvas";
import { ConvoTabs } from "./ConvoTabs";

interface OttoViewProps {
  view: OttoViewKey;
  projectId: string;
  entities: EntityDTO[];
  threads: ChatThreadDTO[];
  activeThreadId: string | null;
  onThreadsChange: (threads: ChatThreadDTO[]) => void;
  onActiveThreadChange: (id: string | null) => void;
  onThreadStarted: (thread: ChatThreadDTO) => void;
  balanceUsd: number;
  userName: string;
  memory: MemoryRow[];
  records: BrandRecordRow[];
  ads: AdTile[];
  adJobs: AdJobItem[];
  history: HistoryThumb[];
  account: AccountInfo | null;
  /** Analytics view payload — wired in Task 5; the Analytics branch consumes it. */
  analytics: AnalyticsData;
  ottoStreamEnabled: boolean;
  onBalanceRefresh: () => Promise<void>;
  onActivityRefresh?: () => Promise<void>;
  onViewChange: (view: OttoViewKey) => void;
  onOpenThread: (threadId: string, projectId?: string) => void;
  activity: Set<string>;
  onDeleteThread: (id: string) => void;
  onNewConvo: () => void;
  seedText?: string;
  onSeedConsumed?: () => void;
  onUseInOtto: (prompt: string) => void;
  /** Collapse the OTTO chat pane to give the canvas full width. */
  chatCollapsed?: boolean;
  onToggleChat?: () => void;
  /** Re-skin flag (?skin=gb) — enables the chat→canvas bridge on the canvas. */
  skin?: "gb";
}

type ThreadComposerReference = OttoComposerReference & { threadId: string };

export function OttoView({
  view,
  projectId,
  entities,
  threads,
  activeThreadId,
  onThreadsChange,
  onActiveThreadChange,
  onThreadStarted,
  balanceUsd,
  userName,
  memory,
  records,
  ads,
  adJobs,
  history,
  account,
  analytics,
  ottoStreamEnabled,
  onBalanceRefresh,
  onActivityRefresh,
  onViewChange,
  onOpenThread,
  activity,
  onDeleteThread,
  onNewConvo,
  seedText,
  onSeedConsumed,
  onUseInOtto,
  chatCollapsed = false,
  onToggleChat,
  skin,
}: OttoViewProps) {
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // Unified Library items — shared by the Memory product picker and the Library surface.
  const stuffItems = useMemo(
    () => buildStuffItems({ entities, history, ads, records }),
    [entities, history, ads, records],
  );

  // The first message for a freshly-created streaming thread, handed up by the front
  // door. Keyed to its threadId + cleared once OttoChatStream has auto-sent it, so a
  // later remount (switch away + back) never re-sends. (Founder streaming front door.)
  const [pendingFirst, setPendingFirst] = useState<
    { threadId: string; text: string; goalKey?: string; entityIds?: string[] } | null
  >(null);
  const [composerReference, setComposerReference] = useState<ThreadComposerReference | null>(null);
  const composerReferenceSeqRef = useRef(0);

  const handleCanvasReference = useCallback((ref: Omit<OttoComposerReference, "requestId">) => {
    if (!activeThreadId) return;
    composerReferenceSeqRef.current += 1;
    setComposerReference({
      ...ref,
      threadId: activeThreadId,
      requestId: `canvas:${activeThreadId}:${ref.generationId}:${composerReferenceSeqRef.current}`,
    });
    if (chatCollapsed) onToggleChat?.();
  }, [activeThreadId, chatCollapsed, onToggleChat]);
  const handleComposerReferenceConsumed = useCallback((requestId: string) => {
    setComposerReference((current) => current?.requestId === requestId ? null : current);
  }, []);

  // Refresh a thread and bring it to the top of the list
  async function refreshThread(id: string): Promise<void> {
    const fresh = await getCoworkThreadClient(id);
    if (fresh) {
      onThreadsChange([fresh, ...threads.filter((t) => t.id !== fresh.id)]);
      onActiveThreadChange(fresh.id);
    }
  }

  if (view === "memory") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoMemory initialMemory={memory} initialRecords={records} projectId={projectId} stuffItems={stuffItems} />
      </div>
    );
  }
  if (view === "schedule") {
    return <OttoSchedule stuffItems={stuffItems} onNavigate={onViewChange} />;
  }
  if (view === "analytics") {
    return <OttoAnalytics initial={analytics} onNavigate={onViewChange} onUseInOtto={onUseInOtto} />;
  }
  if (view === "stuff" || view === "library") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoStuff
          entities={entities}
          ads={ads}
          adJobs={adJobs}
          records={records}
          history={history}
          onOpenThread={onOpenThread}
          onRetryWithOtto={onUseInOtto}
        />
      </div>
    );
  }
  if (view === "account") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoAccount account={account} />
      </div>
    );
  }
  if (view === "templates") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoTemplates projectId={projectId} entities={entities} />
      </div>
    );
  }
  if (view === "discover") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoDiscover onUseInOtto={onUseInOtto} />
      </div>
    );
  }
  if (view === "connections") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoConnections />
      </div>
    );
  }

  // Otto view — front door when no active thread, conversation when one is selected
  const showFrontDoor = !activeThread;
  const isFirstRun =
    showFrontDoor &&
    entities.length === 0 &&
    memory.length === 0 &&
    threads.length === 0;

  return (
    <div
      className={`otto-workspace${chatCollapsed ? " otto-chat-collapsed" : ""}${isFirstRun ? " otto-workspace-first-run" : ""}`}
      style={{ position: "relative", flex: 1, minHeight: 0, height: "100%", display: "flex", flexDirection: "row", overflow: "hidden" }}
    >
      <style>{`
        .otto-onboarding-overlay {
          position: absolute;
          top: 20px;
          left: var(--otto-onboarding-left);
          right: 24px;
          z-index: 20;
          pointer-events: none;
        }
        .otto-onboarding-overlay > * {
          pointer-events: auto;
        }
        @media (max-width: 680px) {
          .otto-workspace:not(.otto-chat-collapsed) .otto-chat-pane {
            flex: 1 1 calc(100% - 26px) !important;
          }
          .otto-workspace:not(.otto-chat-collapsed) .otto-canvas-pane {
            flex: 0 0 26px !important;
            min-width: 26px;
          }
          .otto-workspace:not(.otto-chat-collapsed) .otto-canvas-pane > :not(button),
          .otto-workspace:not(.otto-chat-collapsed) .otto-canvas-pane > :not(button) * {
            visibility: hidden !important;
            pointer-events: none;
          }
          .otto-chat-collapse-handle {
            left: 0 !important;
          }
          .otto-onboarding-overlay {
            top: 12px;
            left: 12px;
            right: 12px;
          }
          .otto-workspace-first-run:not(.otto-chat-collapsed) .otto-chat-pane {
            padding-top: 250px;
            box-sizing: border-box;
          }
          .otto-workspace-first-run:not(.otto-chat-collapsed) .otto-front-door-inner {
            padding-top: 1rem !important;
          }
          .otto-workspace-first-run:not(.otto-chat-collapsed) .otto-front-door {
            justify-content: flex-start !important;
          }
        }
      `}</style>
      {isFirstRun && (
        <div
          className="otto-onboarding-overlay"
          style={{ "--otto-onboarding-left": chatCollapsed ? "24px" : "calc(clamp(360px, 38%, 520px) + 24px)" } as React.CSSProperties}
        >
          <OttoOnboarding
            onGoToStuff={() => onViewChange("library")}
            onGoToMemory={() => onViewChange("memory")}
          />
        </div>
      )}
      {/* Show-OTTO button — visible only while the OTTO pane is collapsed */}
      {chatCollapsed && (
        <button
          type="button"
          onClick={onToggleChat}
          title="Show OTTO"
          aria-label="Show OTTO"
          style={{ position: "absolute", top: 54, left: "0.75rem", zIndex: 40, width: 34, height: 34, borderRadius: "10px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "var(--shadow-sm)" }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden><path d="M13 5l7 7-7 7" /><path d="M4 5v14" /></svg>
        </button>
      )}
      {/* Left pane: agent entry / chat (collapsible) */}
      <div
        className="otto-chat-pane"
        style={{
          flex: chatCollapsed ? "0 0 0px" : "0 0 clamp(360px, 38%, 520px)",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: chatCollapsed ? "none" : "1px solid var(--border)",
          overflow: "hidden",
          transition: "flex-basis 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Conversation tabs — only in the legacy skin. Under gb, conversations are
            navigated from the left Projects sidebar (Grok pattern), so this top
            chip bar is redundant and hidden. */}
        {skin !== "gb" && (
          <ConvoTabs
            threads={threads}
            activeThreadId={activeThreadId}
            activity={activity}
            onSelect={onActiveThreadChange}
            onNew={onNewConvo}
            onDelete={onDeleteThread}
          />
        )}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showFrontDoor ? (
            <OttoFrontDoor
              projectId={projectId}
              entities={entities}
              userName={userName}
              seedText={seedText}
              onSeedConsumed={onSeedConsumed}
              ottoStreamEnabled={ottoStreamEnabled}
              onThreadStarted={onThreadStarted}
              onStreamStart={(thread, pending) => {
                // Streaming front door: an empty thread was created; hand its first
                // message to OttoChatStream, which streams it in on mount.
                onThreadStarted(thread);
                setPendingFirst({ threadId: thread.id, text: pending.text, goalKey: pending.goalKey, entityIds: pending.entityIds });
              }}
            />
          ) : ottoStreamEnabled ? (
            <OttoChatStream
              key={activeThread.id}
              projectId={projectId}
              entities={entities}
              thread={activeThread}
              balanceUsd={balanceUsd}
              onRefresh={() => refreshThread(activeThread.id)}
              onThreadUpdate={(updated) => {
                onThreadsChange([updated, ...threads.filter((t) => t.id !== updated.id)]);
              }}
              onBalanceRefresh={onBalanceRefresh}
              pendingFirst={
                pendingFirst && pendingFirst.threadId === activeThread.id
                  ? { text: pendingFirst.text, goalKey: pendingFirst.goalKey, entityIds: pendingFirst.entityIds }
                  : undefined
              }
              onPendingFirstSent={() => setPendingFirst(null)}
              composerReference={composerReference?.threadId === activeThread.id ? composerReference : null}
              onComposerReferenceConsumed={handleComposerReferenceConsumed}
            />
          ) : (
            <OttoConversation
              projectId={projectId}
              entities={entities}
              thread={activeThread}
              balanceUsd={balanceUsd}
              onRefresh={() => refreshThread(activeThread.id)}
              onThreadUpdate={(updated) => {
                onThreadsChange([updated, ...threads.filter((t) => t.id !== updated.id)]);
              }}
              onBalanceRefresh={onBalanceRefresh}
            />
          )}
        </div>
      </div>
      {/* Right pane: canvas. display:flex so FlowCanvas (flex:1) fills the full
          height — without it the canvas pane collapses to 0 height and React Flow
          renders nothing (the "canvas not working" blank-white regression). */}
      <div className="otto-canvas-pane" style={{ flex: 1, minWidth: 0, minHeight: 0, height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
        {/* Collapse handle on the OTTO↔canvas border */}
        {!chatCollapsed && (
          <button
            type="button"
            onClick={onToggleChat}
            title="Collapse OTTO panel"
            aria-label="Collapse OTTO panel"
            className="otto-chat-collapse-handle"
            style={{ position: "absolute", left: -13, top: 60, zIndex: 30, width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted-foreground)", boxShadow: "var(--shadow-sm)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </button>
        )}
        <FlowCanvas
          projectId={projectId}
          entities={entities}
          activeThreadId={activeThreadId}
          activity={activity}
          skin={skin}
          onBalanceRefresh={onBalanceRefresh}
          onActivityRefresh={onActivityRefresh}
          onReferenceInChat={showFrontDoor ? undefined : handleCanvasReference}
          directToolsLocked={showFrontDoor}
          directToolsLockedReason="Start with Otto to unlock canvas tools."
        />
      </div>
    </div>
  );
}

export default OttoView;
