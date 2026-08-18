"use client";
/**
 * otto-start-thread.ts —— 「开一条新会话,并把第一句话交给流式那一段」这一步,**只有这一份**。
 *
 * 票 #995(W2-8):面板底部的页面快捷 chips 与前门的四个目标格子做的是同一件事 ——
 * 建一条空会话,然后把这一轮的话(以及随行的 goalKey)交给 `OttoChatStream` 在挂载时发出去。
 * 那一段原本只写在 `OttoFrontDoor.start()` 里;chips 再抄一份,两处就会各自漂移
 * (最先漂的一定是标题守卫 `newThreadTitle` —— #979 那个病)。
 *
 * 这里**不花钱**:建的是空会话,一轮都没跑。计费发生在 `OttoChatStream` 把第一句话发出去
 * 之后,与前门原来那条路一模一样。
 */
import { createEmptyCoworkThread } from "./otto-client-actions";
import { newThreadTitle } from "./otto-canned-starters";
import type { ChatThreadDTO } from "./types";

/** 会话建好之后,交给 `OttoChatStream` 在挂载时自动发出去的第一句话。 */
export type PendingFirstMessage = { text: string; goalKey?: string; entityIds?: string[] };

export async function startStreamedThread(input: {
  projectId: string;
  text: string;
  goalKey?: string;
  entityIds?: string[];
}): Promise<{ thread: ChatThreadDTO; pending: PendingFirstMessage } | { error: string }> {
  const text = input.text.trim();
  if (!text) return { error: "Type something for Otto to work on." };

  const created = await createEmptyCoworkThread({ projectId: input.projectId, title: text });
  if ("error" in created) return { error: created.error };

  const thread: ChatThreadDTO = {
    id: created.id,
    projectId: input.projectId,
    // #979:乐观标题走的必须是**服务端刚刚落库的那一份**规矩,否则列表先显我们的标签、
    // 刷新后再翻成 Untitled —— 商家看到的是产品自己改口。
    title: newThreadTitle(text),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  return {
    thread,
    pending: {
      text,
      ...(input.goalKey ? { goalKey: input.goalKey } : {}),
      ...(input.entityIds?.length ? { entityIds: input.entityIds } : {}),
    },
  };
}
