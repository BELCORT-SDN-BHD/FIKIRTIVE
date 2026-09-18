"use client";

import { useCallback } from "react";
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
  /** FRONT-A10:第一句话 `@` 到的对象(类型化 ID),落进 ChatMessage.referenceRefs 供回链。 */
  references?: string[];
  /** 起步页挂的图片素材(规格 §7.3⑨)——首轮按与手动送出**同一份**映射进 body。 */
  sourceGenerationIds?: string[];
  /** 起步页挂的影片素材。 */
  referenceVideoGenerationIds?: string[];
};

export function CanvasOttoOverlay({
  projectId,
  entities,
  balanceUsd,
  activeThread,
  pendingFirst,
  composerReferences,
  onThreadChange,
  onStreamStart,
  onPendingFirstSent,
  onComposerReferencesConsumed,
  onBalanceRefresh,
  onGenerationActivityChange,
  canvasJobActive,
}: {
  projectId: string;
  entities: EntityDTO[];
  balanceUsd: number;
  activeThread: ChatThreadDTO | null;
  pendingFirst: CanvasPendingFirst | null;
  composerReferences: OttoComposerReference[];
  onThreadChange: (thread: ChatThreadDTO) => void;
  onStreamStart: (thread: ChatThreadDTO, pending: Omit<CanvasPendingFirst, "handoffId">) => void;
  onPendingFirstSent: () => void;
  onComposerReferencesConsumed: (requestIds: string[]) => void;
  onBalanceRefresh: () => void | Promise<void>;
  /** 这条对话此刻有没有付费生成在跑 —— 画板据此重读自己的板(走查 P0-1)。 */
  onGenerationActivityChange: (active: boolean) => void;
  /** 反方向那一句(FSE-005):画板上有画布直接动作在跑 —— 对话据此立刻回库里读。 */
  canvasJobActive?: boolean;
}) {
  /**
   * 这一条和上一层那四个回调同一条纪律(R3-F28)：**不许每渲染一次就换一个**。
   *
   * 从前它写在 JSX 里,于是这一层每渲染一次,对话就收到一个新的 `onRefresh`。上一层把四个
   * 回调钉稳之后,这里仍是唯一一个每次都换身份的接缝回调——对话今天没有把它列进任何 effect
   * 依赖表,所以这不是已发生的缺陷,是把守卫补齐:哪天有人把它写进依赖表,形状就和
   * `OttoChatStream.tsx:1439`/`:1139` 那两条一模一样。
   *
   * hook 不能写在下面那个早退后面(React 的规矩),所以对话 id 在这里就先读成可空的一格;
   * 没有对话时这个函数根本不会被交出去。
   */
  const threadId = activeThread?.id ?? null;
  const refreshThread = useCallback(async () => {
    if (!threadId) return;
    const fresh = await getCoworkThreadClient(threadId);
    if (fresh) onThreadChange(fresh);
  }, [threadId, onThreadChange]);

  if (!activeThread) {
    return (
      <OttoFrontDoor
        layout="canvas"
        // ENGINE-A3(otto-engine.md §7.2⑦):画布 composer 的送出从此是**开一条画布对话**,
        // 所以来源写明白 —— 不再靠 `coerceThreadSurface` 的兜底默认值把它归到 canvas。
        // 声明不是判定:服务端仍自己过那一道闸(`lib/otto-thread-surface.ts`)。
        threadSurface="canvas"
        projectId={projectId}
        balanceUsd={balanceUsd}
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
      onRefresh={refreshThread}
      onThreadUpdate={onThreadChange}
      onBalanceRefresh={onBalanceRefresh}
      pendingFirst={pendingFirst ?? undefined}
      onPendingFirstSent={onPendingFirstSent}
      composerReferences={composerReferences}
      onComposerReferencesConsumed={onComposerReferencesConsumed}
      onGenerationActivityChange={onGenerationActivityChange}
      canvasJobActive={canvasJobActive}
    />
  );
}

export default CanvasOttoOverlay;
