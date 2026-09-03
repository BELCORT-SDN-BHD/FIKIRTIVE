"use client";

import type { ChatThreadDTO, EntityDTO } from "@/lib/types";
import type { OttoComposerReference } from "@/lib/canvas-chat-reference";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { OttoChatStream } from "@/components/otto/OttoChatStream";
import { OttoFrontDoor } from "@/components/otto/OttoFrontDoor";

export type CanvasPendingFirst = {
  handoffId?: string;
  text: string;
  goalKey?: string;
  entityIds?: string[];
};

export function CanvasOttoOverlay({
  projectId,
  entities,
  balanceUsd,
  activeThread,
  pendingFirst,
  composerReferences,
  onNewConversation,
  onThreadChange,
  onStreamStart,
  onPendingFirstSent,
  onComposerReferencesConsumed,
  onBalanceRefresh,
  onGenerationActivityChange,
}: {
  projectId: string;
  entities: EntityDTO[];
  balanceUsd: number;
  activeThread: ChatThreadDTO | null;
  pendingFirst: CanvasPendingFirst | null;
  composerReferences: OttoComposerReference[];
  onNewConversation: () => void;
  onThreadChange: (thread: ChatThreadDTO) => void;
  onStreamStart: (thread: ChatThreadDTO, pending: Omit<CanvasPendingFirst, "handoffId">) => void;
  onPendingFirstSent: () => void;
  onComposerReferencesConsumed: (requestIds: string[]) => void;
  onBalanceRefresh: () => void | Promise<void>;
  /** 这条对话此刻有没有付费生成在跑 —— 画板据此重读自己的板(走查 P0-1)。 */
  onGenerationActivityChange: (active: boolean) => void;
}) {
  if (!activeThread) {
    return (
      <OttoFrontDoor
        layout="canvas"
        projectId={projectId}
        balanceUsd={balanceUsd}
        entities={entities}
        userName=""
        onThreadStarted={onThreadChange}
        onStreamStart={onStreamStart}
      />
    );
  }

  return (
    <OttoChatStream
      key={activeThread.id}
      layout="canvas"
      projectId={activeThread.projectId}
      entities={entities}
      thread={activeThread}
      balanceUsd={balanceUsd}
      onNewConversation={onNewConversation}
      onRefresh={async () => {
        const fresh = await getCoworkThreadClient(activeThread.id);
        if (fresh) onThreadChange(fresh);
      }}
      onThreadUpdate={onThreadChange}
      onBalanceRefresh={onBalanceRefresh}
      pendingFirst={pendingFirst ?? undefined}
      onPendingFirstSent={onPendingFirstSent}
      composerReferences={composerReferences}
      onComposerReferencesConsumed={onComposerReferencesConsumed}
      onGenerationActivityChange={onGenerationActivityChange}
    />
  );
}

export default CanvasOttoOverlay;
