import "server-only";

import { redirect } from "next/navigation";
import {
  NorthstarCanvasWorkspace,
  type ImmersiveCanvasRuntimeContext,
} from "@/components/canvas/NorthstarCanvasWorkspace";
import { CANVAS_HREF } from "@fikirtive/core/navigation";
import { getMyAccount } from "@/lib/account-actions";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { requireOwner } from "@/lib/auth-guard";
import { getCoworkThreadPage, getCoworkThreads, getEntities, getProjects, resolveCoworkResultUrls } from "@/lib/data";
import { toChatThreadDTO, toEntityDTO } from "@/lib/dto";
import { getCanvasConversationHandoff } from "@/lib/canvas-entry-actions";
import { isPanelThread } from "@/lib/otto-thread-surface";

export type ImmersiveCanvasSearchParams = Record<
  string,
  string | string[] | undefined
>;

type ProjectChoice = { id: string };
type ThreadChoice = { id: string; updatedAt: Date | string; surface?: string | null };

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function selectImmersiveProject(
  projects: readonly ProjectChoice[],
  ensuredProjectId: string,
  requestedProjectId: string | undefined,
): { activeProjectId: string; shouldRedirect: boolean } {
  const requested = requestedProjectId
    ? projects.find((project) => project.id === requestedProjectId)
    : undefined;

  return {
    activeProjectId: requested?.id ?? projects[0]?.id ?? ensuredProjectId,
    shouldRedirect: requestedProjectId !== undefined && !requested,
  };
}

/**
 * 画布打开时接着聊哪一条。
 *
 * FRONT-A14(判官 P2-3,P1-010 的**镜像**):自动续接不看来源的话,商家在侧栏 Otto 里聊
 * 完,转头打开 Create,画布接上的是那条侧栏对话 —— 与 P1-010 报的是同一个病,只是方向
 * 相反。所以这里把**面板自己的**对话排除在自动续接之外。
 *
 * 排的是 `isPanelThread`,不是「非 canvas」:这一票之前写的老行 `surface = null` 来路无法
 * 回溯,照旧被续(零降级 —— 商家原来能接回哪一条,现在还是哪一条)。
 *
 * 深链 `?thread=` 不受影响:那是商家自己点名的到达,点名什么就开什么。
 */
export function selectImmersiveThread(
  threads: readonly ThreadChoice[],
  requestedThreadId: string | undefined,
): { activeThreadId: string | null; shouldRedirect: boolean } {
  const requested = requestedThreadId
    ? threads.find((thread) => thread.id === requestedThreadId)
    : undefined;
  const mostRecent = threads.reduce<ThreadChoice | null>((latest, thread) => {
    if (isPanelThread(thread.surface)) return latest;
    if (!latest) return thread;
    return new Date(thread.updatedAt).getTime() > new Date(latest.updatedAt).getTime()
      ? thread
      : latest;
  }, null);

  return {
    activeThreadId: requested?.id ?? mostRecent?.id ?? null,
    shouldRedirect: requestedThreadId !== undefined && !requested,
  };
}

export function buildImmersiveCanvasCanonicalUrl(
  searchParams: ImmersiveCanvasSearchParams,
  selection: {
    activeProjectId: string;
    activeThreadId: string | null;
    canonicalizeThread: boolean;
  },
): string {
  const next = new URLSearchParams();
  for (const [key, raw] of Object.entries(searchParams)) {
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const value of values) next.append(key, value);
  }
  next.set("project", selection.activeProjectId);
  if (selection.canonicalizeThread) {
    if (selection.activeThreadId) next.set("thread", selection.activeThreadId);
    else next.delete("thread");
  }
  return `${CANVAS_HREF}?${next.toString()}`;
}

export async function ImmersiveCanvasEntry({
  searchParams,
}: {
  searchParams: Promise<ImmersiveCanvasSearchParams>;
}) {
  const sp = await searchParams;
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) redirect("/login");

  const projects = await getProjects(owner.ownerId);
  const projectSelection = selectImmersiveProject(
    projects,
    ensured.id,
    firstSearchParam(sp.project),
  );
  const [threadRows, accountResult, entityRows] = await Promise.all([
    getCoworkThreads(owner.ownerId, projectSelection.activeProjectId),
    getMyAccount(),
    // The board's prompt box references the merchant's own saved things with @ — without
    // them the mention list is empty and "@ to reference your stuff" promises nothing.
    getEntities(owner.ownerId),
  ]);
  const threadSelection = selectImmersiveThread(
    threadRows,
    firstSearchParam(sp.thread),
  );

  if (projectSelection.shouldRedirect || threadSelection.shouldRedirect) {
    redirect(
      buildImmersiveCanvasCanonicalUrl(sp, {
        activeProjectId: projectSelection.activeProjectId,
        activeThreadId: threadSelection.activeThreadId,
        canonicalizeThread: threadSelection.shouldRedirect,
      }),
    );
  }

  const activeThreadRow = threadSelection.activeThreadId
    ? await getCoworkThreadPage(owner.ownerId, threadSelection.activeThreadId)
    : null;
  const resultUrls = activeThreadRow
    ? await resolveCoworkResultUrls(owner.ownerId, [activeThreadRow])
    : new Map();
  const activeThread = activeThreadRow
    ? { ...toChatThreadDTO(activeThreadRow, resultUrls), hasOlderMessages: activeThreadRow.hasOlderMessages }
    : null;
  const handoffId = firstSearchParam(sp.handoff);
  const handoff = handoffId && activeThread && activeThread.messages.length === 0
    ? await getCanvasConversationHandoff({
        ownerId: owner.ownerId,
        handoffId,
        projectId: projectSelection.activeProjectId,
        threadId: activeThread.id,
      })
    : null;

  if (handoffId && !handoff) {
    const clean = { ...sp };
    delete clean.handoff;
    redirect(
      buildImmersiveCanvasCanonicalUrl(clean, {
        activeProjectId: projectSelection.activeProjectId,
        activeThreadId: threadSelection.activeThreadId,
        canonicalizeThread: true,
      }),
    );
  }

  const runtimeContext: ImmersiveCanvasRuntimeContext = {
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
    threads: threadRows.map((thread) => ({
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      updatedAt: thread.updatedAt.toISOString(),
      pinnedAt: thread.pinnedAt?.toISOString() ?? null,
    })),
    activeProjectId: projectSelection.activeProjectId,
    activeThreadId: threadSelection.activeThreadId,
    initialBalance: "error" in accountResult ? 0 : accountResult.balance,
    initialBalanceUsd: "error" in accountResult ? 0 : accountResult.balanceUsd,
    activeThread,
    // 起步页挂上的引用随 handoff 进这条对话的**首轮**(规格 §7.3⑨)。归属已在
    // `getCanvasConversationHandoff` 里按 ownerId 重查过,这里只是把它交给同一个
    // pendingFirst 通道 —— 画布自己那套引用消费不改。
    pendingFirst:
      handoffId && handoff
        ? {
            handoffId,
            text: handoff.prompt,
            ...(handoff.entityIds.length ? { entityIds: handoff.entityIds } : {}),
            ...(handoff.sourceGenerationIds.length
              ? { sourceGenerationIds: handoff.sourceGenerationIds }
              : {}),
            ...(handoff.referenceVideoGenerationIds.length
              ? { referenceVideoGenerationIds: handoff.referenceVideoGenerationIds }
              : {}),
          }
        : null,
  };

  // #600 (spec #599 D1/D2): this page mounts the mature canvas kernel (FlowCanvas / @xyflow)
  // wearing the north-star skin. The hand-rolled north-star board it replaced was deleted from
  // the tree by #606 (D7 · T7) — there is one canvas implementation now, not two.
  return (
    <NorthstarCanvasWorkspace
      key={`${runtimeContext.activeProjectId}:${runtimeContext.activeThreadId ?? ""}`}
      runtimeContext={runtimeContext}
      entities={entityRows.map(toEntityDTO)}
    />
  );
}
