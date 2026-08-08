"use client";

/**
 * 北极星 Canvas 页的合体外壳(#600 · spec #599 D1/D2/D8)。
 *
 * 皮是北极星,芯是修真过的画布内核:
 *   · 皮 —— 顶栏「项目 · 会话」+ credits 常显、左栏工作区上下文(Search / Chat / Projects)、
 *     沉浸 token(由壳根 `.gb.ns-immersive` 继承,本文件不重复声明)。
 *   · 芯 —— `FlowCanvas`(@xyflow)。生成、轮询、落位、多选、邻近落位、卡片终态、谱系连线
 *     全部来自内核;本文件一条都不复制,也不自建第二条生成路径(钱路只有 useCanvasGen 一条)。
 *
 * 位置在 fenced tree 之外,所以可以直接读授权 runtime;北极星路由文件仍然一行后端都不 import
 * (见 `scripts/check-northstar-imports.sh` 与 create/canvas/page.tsx 顶部注释)。
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { getMyAccount } from "@/lib/account-actions";
import { cn } from "@/lib/utils";
import type { EntityDTO } from "@/lib/types";
import FlowCanvas from "./FlowCanvas";

/**
 * 受控 Entry 交给这块画布的运行时上下文(#606 T7)。
 *
 * 这个类型原先住在 `immersive-canvas-runtime.ts` —— 手搓板的运行时。手搓板随 T7 退役,
 * 整个模块删掉,类型跟着搬到它唯一的消费者这里,不再为一个类型留一个空壳文件。
 */
export type ImmersiveCanvasRuntimeContext = {
  projects: Array<{ id: string; name: string }>;
  threads: Array<{
    id: string;
    projectId: string;
    title: string;
    updatedAt: string;
    pinnedAt: string | null;
  }>;
  activeProjectId: string;
  activeThreadId: string | null;
  initialBalance: number;
};

type SideTab = "chat" | "projects";

/** Labels live here, not in `text-transform` — what is read must equal what is seen (#739). */
const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "projects", label: "Projects" },
];

function canvasHref(projectId: string, threadId?: string): string {
  const thread = threadId ? `&thread=${encodeURIComponent(threadId)}` : "";
  return `/northstar-immersive/create/canvas?project=${encodeURIComponent(projectId)}${thread}`;
}

export function NorthstarCanvasWorkspace({
  runtimeContext,
  entities = [],
}: {
  runtimeContext: ImmersiveCanvasRuntimeContext;
  entities?: EntityDTO[];
}) {
  // credits 常显。内核每次花完钱都会回调 onBalanceRefresh,这里重新读一次真实余额 ——
  // 本地不做任何加减,余额永远是服务端说的数。
  const [balance, setBalance] = useState(runtimeContext.initialBalance);
  const [sideTab, setSideTab] = useState<SideTab>("chat");
  const [sideSearch, setSideSearch] = useState("");

  const refreshBalance = useCallback(async () => {
    const account = await getMyAccount();
    if (!("error" in account)) setBalance(account.balance);
  }, []);

  const activeProject = runtimeContext.projects.find((project) => project.id === runtimeContext.activeProjectId);
  const activeThread = runtimeContext.threads.find((thread) => thread.id === runtimeContext.activeThreadId);
  const query = sideSearch.toLowerCase();
  const projectThreads = runtimeContext.threads.filter(
    (thread) => thread.projectId === runtimeContext.activeProjectId,
  );

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* ── 左栏:工作区上下文(Search + 本项目会话 + 项目切换)。壳级 240 导航已提供 New 与
         History,所以这里不再并列成第二条全局导航。 ── */}
      <aside className="hidden w-56 shrink-0 flex-col bg-muted/40 lg:flex">
        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
            <input
              value={sideSearch}
              onChange={(event) => setSideSearch(event.target.value)}
              placeholder="Search"
              aria-label="Search canvases"
              className="h-9 w-full rounded-[10px] border border-input bg-card pr-2 pl-8 text-[13px] text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
          </div>
        </div>
        {/* #739 — the case belongs in the copy, not in `text-transform`: CSS capitalisation
            shows "Chat" but leaves the accessible name as the raw key "chat". */}
        <div className="flex gap-1 px-3">
          {SIDE_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSideTab(id)}
              aria-pressed={sideTab === id}
              className={cn(
                "h-8 flex-1 rounded-[10px] text-xs font-semibold transition-colors duration-[120ms]",
                sideTab === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {sideTab === "chat" && (
            <div className="flex flex-col gap-1">
              {projectThreads
                .filter((thread) => thread.title.toLowerCase().includes(query))
                .map((thread) => (
                  <Link
                    key={thread.id}
                    href={canvasHref(thread.projectId, thread.id)}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-[10px] px-3 text-left text-[13px] transition-colors duration-[120ms]",
                      runtimeContext.activeThreadId === thread.id
                        ? "bg-secondary font-semibold text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{thread.title}</span>
                    {thread.pinnedAt && <span className="ml-auto text-[10px] text-muted-foreground">Pinned</span>}
                  </Link>
                ))}
              {projectThreads.length === 0 && (
                <p className="px-2 py-3 text-[12px] leading-4 text-muted-foreground">
                  No live thread is attached to this project canvas.
                </p>
              )}
            </div>
          )}
          {sideTab === "projects" && (
            <div className="flex flex-col gap-1">
              {runtimeContext.projects
                .filter((project) => project.name.toLowerCase().includes(query))
                .map((project) => (
                  <Link
                    key={project.id}
                    href={canvasHref(project.id)}
                    className={cn(
                      "flex min-h-9 items-center rounded-[10px] px-3 py-2 text-[13px] transition-colors duration-[120ms]",
                      runtimeContext.activeProjectId === project.id
                        ? "bg-secondary font-semibold text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{project.name}</span>
                  </Link>
                ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── 画布区:顶栏(项目 · 会话 + credits 常显)+ 修真内核 ── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {activeProject?.name ?? "Current project"} · {activeThread?.title ?? "Canvas"}
          </span>
          <div className="flex-1" />
          <span
            aria-live="polite"
            className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums"
          >
            {balance.toLocaleString()} credits
          </span>
        </div>

        {/* display:flex + minHeight:0 —— FlowCanvas 是 flex:1,少了这两条画布高度会塌成 0
           (线上 Otto 页同款修法),React Flow 就什么都不画。 */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <FlowCanvas
            projectId={runtimeContext.activeProjectId}
            entities={entities}
            activeThreadId={runtimeContext.activeThreadId}
            skin="gb"
            onBalanceRefresh={refreshBalance}
            defaultComposerOpen
          />
        </div>
      </section>
    </div>
  );
}

export default NorthstarCanvasWorkspace;
