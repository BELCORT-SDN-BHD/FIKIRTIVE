"use client";
import React, { useState } from "react";
import type { OttoViewKey } from "./OttoApp";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import type { MemoryRow } from "@/lib/memory-actions";
import type { AccountInfo } from "@/lib/account-actions";
import { OttoFrontDoor } from "./OttoFrontDoor";
import { OttoConversation } from "./OttoConversation";
import { OttoChatStream } from "./OttoChatStream";
import { OttoMemory } from "./OttoMemory";
import { OttoAccount } from "./OttoAccount";
import { OttoStuff, type AdTile } from "./OttoStuff";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";

interface OttoViewProps {
  view: OttoViewKey;
  projectId: string;
  entities: EntityDTO[];
  threads: ChatThreadDTO[];
  activeThreadId: string | null;
  onThreadsChange: (threads: ChatThreadDTO[]) => void;
  onActiveThreadChange: (id: string | null) => void;
  balanceUsd: number;
  userName: string;
  memory: MemoryRow[];
  ads: AdTile[];
  account: AccountInfo | null;
  ottoStreamEnabled: boolean;
}

export function OttoView({
  view,
  projectId,
  entities,
  threads,
  activeThreadId,
  onThreadsChange,
  onActiveThreadChange,
  balanceUsd,
  userName,
  memory,
  ads,
  account,
  ottoStreamEnabled,
}: OttoViewProps) {
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // The first message for a freshly-created streaming thread, handed up by the front
  // door. Keyed to its threadId + cleared once OttoChatStream has auto-sent it, so a
  // later remount (switch away + back) never re-sends. (Founder streaming front door.)
  const [pendingFirst, setPendingFirst] = useState<
    { threadId: string; text: string; goalKey?: string } | null
  >(null);

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
        <OttoMemory initialMemory={memory} />
      </div>
    );
  }
  if (view === "stuff") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoStuff entities={entities} ads={ads} />
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

  // Otto view — front door when no active thread, conversation when one is selected
  const showFrontDoor = !activeThread;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {showFrontDoor ? (
        <OttoFrontDoor
          projectId={projectId}
          entities={entities}
          userName={userName}
          ottoStreamEnabled={ottoStreamEnabled}
          onThreadStarted={(thread) => {
            onThreadsChange([thread, ...threads]);
            onActiveThreadChange(thread.id);
          }}
          onStreamStart={(thread, pending) => {
            // Streaming front door: an empty thread was created; hand its first
            // message to OttoChatStream, which streams it in on mount.
            onThreadsChange([thread, ...threads]);
            onActiveThreadChange(thread.id);
            setPendingFirst({ threadId: thread.id, text: pending.text, goalKey: pending.goalKey });
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
          pendingFirst={
            pendingFirst && pendingFirst.threadId === activeThread.id
              ? { text: pendingFirst.text, goalKey: pendingFirst.goalKey }
              : undefined
          }
          onPendingFirstSent={() => setPendingFirst(null)}
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
        />
      )}
    </div>
  );
}

export default OttoView;
