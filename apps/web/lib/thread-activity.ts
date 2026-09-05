import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { PANEL_THREAD_SURFACE } from "./otto-thread-surface";

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

/**
 * Per-thread activity for one project: a thread is "pending" when it has an in-flight
 * GenJob (QUEUED/GENERATING) or an old pending CanvasNode that is not linked to a
 * settled job. Read-only, owner+project scoped.
 */
export async function listProjectThreadActivity(
  projectId: string,
): Promise<{ threadId: string; pending: boolean }[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(projectId, gate.ownerId))) return { error: "Project not found." };
  const { ownerId } = gate;

  const [threads, jobs, nodes] = await Promise.all([
    prisma.chatThread.findMany({ where: { ownerId, projectId, deletedAt: null }, select: { id: true } }),
    prisma.genJob.findMany({
      where: { ownerId, projectId, status: { in: ["QUEUED", "GENERATING"] }, threadId: { not: null } },
      select: { id: true, threadId: true },
    }),
    prisma.canvasNode.findMany({
      where: { ownerId, projectId, status: "pending", threadId: { not: null } },
      select: { threadId: true, genJobId: true },
    }),
  ]);

  const pending = new Set<string>();
  const inFlightJobIds = new Set(jobs.map((j) => j.id));
  for (const j of jobs) if (j.threadId) pending.add(j.threadId);
  for (const n of nodes) {
    if (n.threadId && n.genJobId && inFlightJobIds.has(n.genJobId)) pending.add(n.threadId);
  }

  return threads.map((t) => ({ threadId: t.id, pending: pending.has(t.id) }));
}

/**
 * 侧栏面板要不要因为「这个商家有进行中的面板对话」而展开 —— 这一句的唯一权威。
 *
 * 口径是**全店**,不是「本页」(#1215 判官 P2-3:这里从前写着「本页有进行中的对话」,
 * 而下面的查询按 `ownerId` 收口、一个 project 参数都没有 —— 读者按文件头去理解行为会
 * 读错一整条)。落座那一边(`otto-panel-seed.ts`)也是全店,两处是同一句话。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14)。2026-09-04 Founder 把
 * 「这一页有活动对话即展开」追认为**近似**:当时读的是深链 `?otto=1`,而 `?otto=1` 说的
 * 是「商家点名要开面板」,不是「这里有一段正在跑的对话」——商家在 Library 留着一条在跑的
 * 对话、离开再回来,面板不展开;`?otto=1` 不带 thread 也照样强开。这个函数就是那条登记
 * 「真信号,下一轮」的落点。
 *
 * 判据两句,缺一不可:
 *   ① **在途**:这个商家名下有一单 `QUEUED`/`GENERATING` 的 `GenJob` 挂在某条对话上;
 *   ② **面板自己的对话**:那条对话 `surface = 'panel'`(`PANEL_THREAD_SURFACE`)。
 *
 * 第 ② 句不是多余的谨慎。面板「打开时接着聊哪一条」今天只在 `surface='panel'` 的对话里
 * 选(`otto-panel-seed.ts`,同一条 FRONT-A14 裁决)。少了它,一单画布生成会把面板顶开,
 * 而面板打开后画的是**新对话空态** —— 商家看到的是「凭空弹出来一块空面板」,比不展开
 * 更糟。老行(`surface = null`,那条规则之前写的每一条)按画布读,同样不算 —— 与
 * `otto-thread-surface.ts` 的「拿不准就不自动做」同一口径。
 *
 * 租户:`ownerId` 只来自 `requireOwner()`(服务端 principal),客户端一个字段都不传;
 * 两条查询都按它收口,别家 org 的在途生成读不到,也算不上。
 *
 * 没有 project 参数是有意的:面板挂在**每一个**商家表面上,展开与否是这次到访的整体
 * 判断,不是某一个 project 的事;而 `getOrCreateDefaultProject()` 那条路会**建**一个
 * project —— 一个纯读的展开信号不该有副作用。
 */
export async function hasPendingPanelThread(): Promise<{ pending: boolean } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const jobs = await prisma.genJob.findMany({
    where: { ownerId, status: { in: ["QUEUED", "GENERATING"] }, threadId: { not: null } },
    select: { threadId: true },
  });
  const threadIds = [...new Set(jobs.map((j) => j.threadId).filter((id): id is string => id !== null))];
  if (threadIds.length === 0) return { pending: false };

  const panelThread = await prisma.chatThread.findFirst({
    where: { ownerId, id: { in: threadIds }, deletedAt: null, surface: PANEL_THREAD_SURFACE },
    select: { id: true },
  });
  return { pending: panelThread !== null };
}
