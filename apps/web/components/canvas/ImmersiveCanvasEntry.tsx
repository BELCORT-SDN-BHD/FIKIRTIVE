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
import { getCoworkThreads, getEntities, getProjects } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import {
  QUICK_CREATE_PROJECT_ID,
  QUICK_CREATE_PROJECT_NAME,
} from "@/components/library/library-fixture";
import {
  NEW_PROJECT_FIXTURE_ID,
  NEW_PROJECT_FIXTURE_FALLBACK_NAME,
} from "@/components/canvas/r22-canvas-fixture";

export type ImmersiveCanvasSearchParams = Record<
  string,
  string | string[] | undefined
>;

type ProjectChoice = { id: string };
type ThreadChoice = { id: string; updatedAt: Date | string };

/**
 * 样例画布此刻真的存在的那几块板。
 *
 * 为什么它必须是一份**名录**、而不是一个写死的项目:Library 的 Quick create 做完之后给的
 * 「Continue in Canvas」指的是 `?project=fixture-quick-create`,而这一批成品与那句话正是
 * 按这个 projectId 存进浏览器会话的。fixture 分支要是把项目一律当成 Raya launch,商家点
 * 过去看到的永远是另一块板 —— 顶栏写着别人的名字,自己刚做的东西一件都不在,而且没有
 * 任何一处会报错。所以这一支与真实那一支走同一个 `selectImmersiveProject`。
 */
const FIXTURE_PROJECTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "fixture-raya", name: "Raya launch" },
  { id: QUICK_CREATE_PROJECT_ID, name: QUICK_CREATE_PROJECT_NAME },
  // 商家刚在 Create 对话框里说完一句话建出来的那一个。名录里认不出它,`selectImmersiveProject`
  // 就会静默退回第一项 —— 于是他按下建项目、进去看到的是 Raya launch,而且没有一处会报错。
  // 这里的名字只是兜底:真的建过之后,顶栏读的是那句话派生出来的短名。
  { id: NEW_PROJECT_FIXTURE_ID, name: NEW_PROJECT_FIXTURE_FALLBACK_NAME },
];

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

export function selectImmersiveThread(
  threads: readonly ThreadChoice[],
  requestedThreadId: string | undefined,
): { activeThreadId: string | null; shouldRedirect: boolean } {
  const requested = requestedThreadId
    ? threads.find((thread) => thread.id === requestedThreadId)
    : undefined;
  const mostRecent = threads.reduce<ThreadChoice | null>((latest, thread) => {
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
  const visualFixture =
    process.env.NODE_ENV !== "production" && firstSearchParam(sp.fixture) === "r22";

  // 浏览器 parity 必须在正式 route 上、同一个 viewport 复现,但 QA 数据不能穿过生产边界。
  // 这个分支只在非 production 且显式 `?fixture=r22` 时存在,并在任何 auth/DB 读取前返回。
  if (visualFixture) {
    const requestedState = firstSearchParam(sp.state);
    const fixtureRouteState = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "missing" || requestedState === "unknown" ? requestedState : "ready";
    const requestedSend = firstSearchParam(sp.send);
    const fixtureSendOutcome = requestedSend === "error" || requestedSend === "permission" || requestedSend === "credits" || requestedSend === "unknown" ? requestedSend : "success";
    const fixtureSelection = selectImmersiveProject(
      FIXTURE_PROJECTS,
      FIXTURE_PROJECTS[0]!.id,
      firstSearchParam(sp.project),
    );
    const fixtureContext: ImmersiveCanvasRuntimeContext = {
      projects: FIXTURE_PROJECTS.map((project) => ({ ...project })),
      threads: [],
      activeProjectId: fixtureSelection.activeProjectId,
      activeThreadId: null,
      initialBalance: 1240,
      initialPrompt: firstSearchParam(sp.prompt) ?? "",
      visualFixture: "r22",
      fixtureRouteState,
      fixtureSendOutcome,
    };
    return <NorthstarCanvasWorkspace runtimeContext={fixtureContext} entities={[]} />;
  }

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
    initialBalance: "error" in accountResult ? null : accountResult.balance,
    initialPrompt: firstSearchParam(sp.prompt) ?? "",
    visualFixture: null,
  };

  // 视觉 fixture 只能由非 production 的显式 query 打开。正常请求仍使用真实项目身份与
  // 服务端数据边界;未接通的 frontend 状态必须诚实显示,不能把 QA 样本伪装成成功数据。
  return (
    <NorthstarCanvasWorkspace
      key={`${runtimeContext.activeProjectId}:${runtimeContext.activeThreadId ?? ""}`}
      runtimeContext={runtimeContext}
      entities={entityRows.map(toEntityDTO)}
    />
  );
}
