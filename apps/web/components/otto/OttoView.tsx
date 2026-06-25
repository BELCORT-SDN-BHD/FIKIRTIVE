"use client";
import React, { useState } from "react";
import type { OttoViewKey } from "./OttoApp";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import type { MemoryRow } from "@/lib/memory-actions";
import type { AccountInfo } from "@/lib/account-actions";
import { OttoFrontDoor } from "./OttoFrontDoor";
import { OttoConversation } from "./OttoConversation";
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
  onEditByHand: () => void;
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
  onEditByHand,
}: OttoViewProps) {
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

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
          onThreadStarted={(thread) => {
            onThreadsChange([thread, ...threads]);
            onActiveThreadChange(thread.id);
          }}
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
          onEditByHand={onEditByHand}
        />
      )}
    </div>
  );
}

export default OttoView;
