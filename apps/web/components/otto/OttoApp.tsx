"use client";
import React, { useState } from "react";
import "../../app/otto/otto-theme.css";
import { OttoNav } from "./OttoNav";
import { OttoView } from "./OttoView";
import { OttoWorkshop } from "./OttoWorkshop";
import type { AdTile } from "./OttoStuff";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import type { MemoryRow } from "@/lib/memory-actions";
import type { AccountInfo } from "@/lib/account-actions";

export interface OttoAppProps {
  projectId: string;
  entities: EntityDTO[];
  threads: ChatThreadDTO[];
  balanceUsd: number;
  userName: string;
  userEmail: string;
  memory: MemoryRow[];
  ads: AdTile[];
  account: AccountInfo | null;
  ottoStreamEnabled: boolean;
}

export type OttoViewKey = "otto" | "stuff" | "memory" | "account";

export function OttoApp({
  projectId,
  entities,
  threads: initialThreads,
  balanceUsd,
  userName,
  userEmail,
  memory,
  ads,
  account,
  ottoStreamEnabled,
}: OttoAppProps) {
  const [view, setView] = useState<OttoViewKey>("otto");
  const [threads, setThreads] = useState<ChatThreadDTO[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreads[0]?.id ?? null,
  );
  const [workshopOpen, setWorkshopOpen] = useState(false);

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
        balanceUsd={balanceUsd}
        userName={userName}
        userEmail={userEmail}
      />

      {/* Main content area */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
          account={account}
          ottoStreamEnabled={ottoStreamEnabled}
          onEditByHand={() => setWorkshopOpen(true)}
        />
      </div>

      {workshopOpen && <OttoWorkshop onBack={() => setWorkshopOpen(false)} />}
    </div>
  );
}

export default OttoApp;
