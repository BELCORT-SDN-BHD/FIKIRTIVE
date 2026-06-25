"use client";
import React, { useState } from "react";
import type { OttoViewKey } from "./OttoApp";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import { OttoFrontDoor } from "./OttoFrontDoor";
import { OttoConversation } from "./OttoConversation";
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
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        gap: "var(--space-3)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-xl)",
          color: "var(--text-strong)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "var(--text-base)", color: "var(--text-muted)" }}>
        Coming soon
      </div>
    </div>
  );
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

  if (view !== "otto") {
    const labels: Record<OttoViewKey, string> = {
      otto: "Otto",
      stuff: "My stuff",
      memory: "Brand memory",
      account: "Account",
    };
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ComingSoon label={labels[view]} />
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
        />
      )}
    </div>
  );
}

export default OttoView;
