import "server-only";

import { redirect } from "next/navigation";
import {
  NorthstarCanvasWorkspace,
  type ImmersiveCanvasRuntimeContext,
} from "@/components/canvas/NorthstarCanvasWorkspace";
import { CANVAS_HREF } from "@fikirtive/core/navigation";
import { CanvasDeepLinkRefused } from "@/components/canvas/CanvasDeepLinkRefused";
import { getMyAccount } from "@/lib/account-actions";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { requireOwner } from "@/lib/auth-guard";
import { getAllCoworkThreadMetas, getCoworkThreadPage, getCoworkThreads, getEntities, getProjects, resolveCoworkResultUrls, resolveCoworkMessageReferences } from "@/lib/data";
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

/**
 * FSE-207(规格 §5,Founder 2026-09-12 #1358 裁「零写入」为硬口径)——
 * 「这条深链我们打不开」是一道**在任何写入之前**就要问完的题。
 *
 * 从前的答法是「打不开就兜底」:先 `getOrCreateDefaultProject()`(没有画布的租户会被
 * 建一张)、再把地址改写成兜底那张,于是别的租户的深链在访问者那边**静默**变成一张空白
 * 新画布 ＋ 一行 `project.create` 审计。判据本身没错(「这个 id 在不在他自己的清单里」),
 * 错的是它的**位置**和**答完之后干什么**。
 *
 * FSE-207b(同一条 §5 登记行的「未做」①,PR #1396 只裁了 `?project=` 这一支)—— `?thread=`
 * 走的是同一个坑:解析不了时旧口径按「规范化重定向」处理,地址被悄悄改写、没有一句人话,
 * 而对一个还没有任何画布的租户,这条路在改写之前会先经过 `getOrCreateDefaultProject()`,
 * 于是一次访问被伪造/别家的 `?thread=` 就 bootstrap 出一张画布 —— 写入的因头是这次访问,
 * 但商家看到的效果就是「打一条深链,凭空多了一张画布」,与「零写入」要守住的精神相冲。
 * 所以 project 与 thread 共用同一个判定(`isUnresolvedDeepLinkId`)和同一张拒绝页:是不是
 * 「在他自己的清单里」这道题,答案对两种深链同形。
 */
function isUnresolvedDeepLinkId(
  ownedIds: readonly string[],
  requestedId: string | undefined,
): boolean {
  if (requestedId === undefined) return false;
  return !ownedIds.includes(requestedId);
}

export function isUnresolvedProjectDeepLink(
  projects: readonly ProjectChoice[],
  requestedProjectId: string | undefined,
): boolean {
  return isUnresolvedDeepLinkId(
    projects.map((project) => project.id),
    requestedProjectId,
  );
}

/** FSE-207b —— 与 `isUnresolvedProjectDeepLink` 同一判定,标的换成商家自己名下**所有
 *  project 里**的对话(见调用点 `getAllCoworkThreadMetas`,租户全量、非当前 project 范围)。 */
export function isUnresolvedThreadDeepLink(
  threads: readonly { id: string }[],
  requestedThreadId: string | undefined,
): boolean {
  return isUnresolvedDeepLinkId(
    threads.map((thread) => thread.id),
    requestedThreadId,
  );
}

export function selectImmersiveProject(
  projects: readonly ProjectChoice[],
  ensuredProjectId: string,
  requestedProjectId: string | undefined,
): { activeProjectId: string } {
  const requested = requestedProjectId
    ? projects.find((project) => project.id === requestedProjectId)
    : undefined;

  return { activeProjectId: requested?.id ?? projects[0]?.id ?? ensuredProjectId };
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

  // FSE-207 / FSE-207b:清单先读、拒绝先判,`getOrCreateDefaultProject()` 排在它们后面
  // —— 那一条会**建**一张画布(`actions.ts` 的 `project.create` ＋ 审计行),所以它一个
  // 字节都不许在「这条深链我们打不开」这题答完之前执行。打不开就到此为止:不改写地址、
  // 不建任何东西。project 与 thread 两道题都要在这里问完(`?thread=` 单独出现、
  // `?project=` 不在场时,项目那道题天然放行——照旧只问 thread 那道)。
  const requestedProjectId = firstSearchParam(sp.project);
  const ownedProjects = await getProjects(owner.ownerId);
  if (isUnresolvedProjectDeepLink(ownedProjects, requestedProjectId)) {
    return <CanvasDeepLinkRefused />;
  }

  // FSE-207b:`getAllCoworkThreadMetas` 是租户全量(不按 project 过滤)的纯读 —— 这里要问的
  // 是「这条 id 是不是我名下任何一个画布里的对话」,不是「是不是当前这张画布里的」;后者
  // 仍由下面 `selectImmersiveThread` 的既有归一化处理(同租户、跨 project 的深链正常导航,
  // 不在本票范围)。只在真带了 `?thread=` 时才多发这一次查询。
  const requestedThreadId = firstSearchParam(sp.thread);
  if (requestedThreadId !== undefined) {
    const ownedThreadMetas = await getAllCoworkThreadMetas(owner.ownerId);
    if (isUnresolvedThreadDeepLink(ownedThreadMetas, requestedThreadId)) {
      return <CanvasDeepLinkRefused />;
    }
  }

  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) redirect("/login");

  // 一张画布都还没有的租户:上面那次读发生在 bootstrap 之前,所以这里重读一次,侧栏的画布
  // 清单才不会比改动之前少一张(这一趟只在「一张都没有」时发生,也就是每个租户的第一次)。
  const projects = ownedProjects.length > 0 ? ownedProjects : await getProjects(owner.ownerId);
  const projectSelection = selectImmersiveProject(projects, ensured.id, requestedProjectId);
  const [threadRows, accountResult, entityRows] = await Promise.all([
    getCoworkThreads(owner.ownerId, projectSelection.activeProjectId),
    getMyAccount(),
    // The board's prompt box references the merchant's own saved things with @ — without
    // them the mention list is empty and "@ to reference your stuff" promises nothing.
    getEntities(owner.ownerId),
  ]);
  const threadSelection = selectImmersiveThread(threadRows, requestedThreadId);

  if (threadSelection.shouldRedirect) {
    redirect(
      buildImmersiveCanvasCanonicalUrl(sp, {
        activeProjectId: projectSelection.activeProjectId,
        activeThreadId: threadSelection.activeThreadId,
        canonicalizeThread: true,
      }),
    );
  }

  const activeThreadRow = threadSelection.activeThreadId
    ? await getCoworkThreadPage(owner.ownerId, threadSelection.activeThreadId)
    : null;
  const [resultUrls, messageReferences] = activeThreadRow
    ? await Promise.all([
        resolveCoworkResultUrls(owner.ownerId, [activeThreadRow]),
        // FRONT-A10 回链:画布这条读路也要带上「这条消息提到了谁」。
        resolveCoworkMessageReferences(owner.ownerId, [activeThreadRow]),
      ])
    : [new Map(), new Map()];
  const activeThread = activeThreadRow
    ? {
        ...toChatThreadDTO(activeThreadRow, resultUrls, messageReferences),
        hasOlderMessages: activeThreadRow.hasOlderMessages,
      }
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
