"use client";

/**
 * OttoThreadList.tsx —— 会话历史,在面板里。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4(「☰ 历史」那一段);票 #995(W2-8)。
 *
 * 这是**搬家,不是重写**:分组与顺序完全由 `otto-nav-model.ts` 决定,与今天第二条导轨
 * (`OttoNav.tsx`)读的是同一个 `buildOttoNavEntries`、同一组上限。这个文件只负责在
 * 320px 宽的面板里把那份模型画出来,一行取数、一行排序都没有。导轨本身不在这一票里删
 * (那是 W2-11),所以这段时间里两处画的必须是同一份历史 —— 模型只有一份,就不可能不是。
 *
 * W2-11(切换总票):置顶/改名/删除三个行内控件从导轨(`OttoNav.tsx`)搬到了这里 ——
 * 换壳删掉了那条导轨本身,整理会话不能跟着一起消失(「换壳丢功能」是核心能力不容马虎的
 * 反面)。业务动作函数原样复用(`@/lib/otto-client-actions`,Shared actions 纪律,
 * 见 `OttoPanelHost.tsx`),这个文件只加控件本身,悬停/聚焦时才现出来,与导轨原来的
 * 密度、图标一致。
 */

import * as React from "react";
import { MoreHorizontal, Pencil, Pin, SquarePen, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatThreadDTO } from "@/lib/types";
import { isCanvasThread } from "@/lib/otto-thread-surface";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";
import {
  OTTO_NAV_PROJECT_LIMIT,
  OTTO_NAV_THREAD_LIMIT,
  buildOttoNavEntries,
  groupThreadsByDate,
  type OttoNavProjectMeta,
} from "@/components/otto/otto-nav-model";

export interface OttoThreadListProps {
  projects: OttoNavProjectMeta[];
  /** 每一个 project 的会话 meta —— 与 `/otto` 侧栏拿到的是同一份。 */
  threads: ChatThreadDTO[];
  activeProjectId: string;
  activeThreadId: string | null;
  onSelectThread: (thread: ChatThreadDTO) => void;
  onNewChat: () => void;
  /** 打开改名对话框(与 `OttoNav.tsx` 同一颗:`OttoRenameDialog`,由上层持有)。 */
  onRenameThread: (id: string) => void;
  /** 置顶/取消置顶 —— 直接生效,不经确认(与导轨原来的行为一致)。 */
  onSetThreadPinned: (id: string, pinned: boolean) => void;
  /** 打开删除确认(与 `OttoNav.tsx` 同一颗:`OttoConfirmDialog`,由上层持有)。 */
  onDeleteThread: (id: string) => void;
  /** 项目一层的同三件事 —— 挂在项目标题行上,不是又开一个列表。 */
  onRenameProject: (id: string) => void;
  onSetProjectPinned: (id: string, pinned: boolean) => void;
  onDeleteProject: (id: string) => void;
  /** 正在取这一条的消息 —— 取到了上层才切过去,所以这一下要看得见。 */
  openingThreadId?: string | null;
  /** 打不开时那句话。留在列表上说,不切过去让商家盯着一片空白。 */
  error?: string | null;
  /**
   * 日期分档相对哪一刻算 —— 由上层在**打开历史的那一下**读一次(那是一个事件),
   * 而不是在这里每次渲染读一次 `Date.now()`:同一份列表在重画时换一档,是一个只在跨午夜
   * 那一瞬间出现、永远重现不了的 bug。
   */
  now: number;
}

function statusDot(status: ChatThreadDTO["status"]): string | null {
  return status === "working" ? "bg-warning" : status === "failed" ? "bg-error" : status === "done" ? "bg-success" : null;
}

export function OttoThreadList({
  projects,
  threads,
  activeProjectId,
  activeThreadId,
  onSelectThread,
  onNewChat,
  onRenameThread,
  onSetThreadPinned,
  onDeleteThread,
  onRenameProject,
  onSetProjectPinned,
  onDeleteProject,
  openingThreadId = null,
  error = null,
  now,
}: OttoThreadListProps) {
  const entries = buildOttoNavEntries({
    projects,
    sidebarThreads: threads,
    activeProjectId,
    activeThreadId,
    projectLimit: OTTO_NAV_PROJECT_LIMIT,
    threadLimit: OTTO_NAV_THREAD_LIMIT,
  });
  const hasAnyThread = entries.some((entry) => entry.kind === "project" && entry.threads.length > 0);

  return (
    <div data-otto-thread-list="" className="flex flex-col gap-3 px-2 py-3">
      <Button
        type="button"
        variant="outline"
        data-otto-thread-list-new=""
        disabled={openingThreadId !== null}
        onClick={onNewChat}
        className="h-9 w-full justify-start gap-2 rounded-[10px] px-3 text-[13px] font-medium"
      >
        <SquarePen className="size-4 shrink-0" strokeWidth={1.9} aria-hidden />
        New chat
      </Button>

      {error && (
        <Alert
          role="alert"
          variant="destructive"
          data-otto-thread-list-error=""
          className="px-3 py-2 text-xs"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!hasAnyThread && (
        // 说真话:没有会话就说没有,不摆一份假的历史。
        <p data-otto-thread-list-empty="" className="px-1 py-2 text-[12.5px] text-muted-foreground">
          Your conversations will show up here once you start one.
        </p>
      )}

      {entries.map((entry) => {
        if (entry.kind !== "project") return null;
        const project = entry.project;
        const groups = groupThreadsByDate(entry.threads, now);
        const projectPinned = Boolean(project.pinnedAt);
        return (
          <div key={project.id} data-otto-thread-list-project={project.id} className="group/project flex flex-col gap-1">
            <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/70 uppercase">
              {projectPinned && <Pin className="size-3 shrink-0" fill="currentColor" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`size-[20px] shrink-0 rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[state=open]:opacity-100 ${projectPinned ? "opacity-100" : ""}`}
                    aria-label={`${project.name} controls`}
                    title={`${PRODUCT_VOCABULARY.canvas} controls`}
                  >
                    <MoreHorizontal className="size-3.5" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onSelect={() => onSetProjectPinned(project.id, !projectPinned)}>
                    <Pin className="size-3.5" fill={projectPinned ? "currentColor" : "none"} aria-hidden />
                    {projectPinned ? `Unpin ${PRODUCT_VOCABULARY.canvas}` : `Pin ${PRODUCT_VOCABULARY.canvas}`}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onRenameProject(project.id)}>
                    <Pencil className="size-3.5" aria-hidden />
                    {`Rename ${PRODUCT_VOCABULARY.canvas}`}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => onDeleteProject(project.id)}>
                    <Trash2 className="size-3.5" aria-hidden />
                    {`Delete ${PRODUCT_VOCABULARY.canvas}`}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {entry.threads.length === 0 ? (
              <p className="px-1 pb-1 text-[12px] text-muted-foreground/70">No conversations yet</p>
            ) : (
              groups.map((group, index) => (
                <div key={`${group.bucket}:${index}`} className="flex flex-col gap-0.5">
                  <div
                    data-otto-thread-list-bucket={group.bucket}
                    className="px-1 pt-1 text-[11px] text-muted-foreground/70"
                  >
                    {group.bucket}
                  </div>
                  {group.threads.map((thread) => {
                    const active = thread.id === activeThreadId;
                    const opening = thread.id === openingThreadId;
                    const pinned = Boolean(thread.pinnedAt);
                    const dot = statusDot(thread.status);
                    return (
                      <div key={thread.id} className="group/thread relative flex items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          data-otto-thread-list-thread={thread.id}
                          {...(active ? { "aria-current": "true" as const } : {})}
                          {...(opening ? { "aria-busy": true } : {})}
                          disabled={openingThreadId !== null}
                          onClick={() => onSelectThread(thread)}
                          title={thread.title}
                          className={`h-auto w-full min-w-0 justify-start gap-2 rounded-[10px] py-1.5 pr-14 pl-2 text-left text-[13px] ${
                            active ? "bg-secondary font-semibold text-foreground" : "font-normal text-muted-foreground"
                          }`}
                        >
                          {pinned && <Pin className="size-3 shrink-0" fill="currentColor" aria-hidden />}
                          {/* FRONT-A14:来源标签。面板只自动续它自己开的对话,画布对话要
                              商家在这里显式点选 —— 那就得让他看得出哪一条是画布的,否则
                              点开一条 /billing 上毫不相干的画布对话仍然只能靠猜。
                              判官 P2-1:只标**确知**是画布的那几条(`isCanvasThread`)。
                              这一票之前写的老行 `surface = null` 来路无法回溯,不挂徽章 ——
                              替一件查不出来的事作证,比不说更糟。 */}
                          {isCanvasThread(thread.surface) && (
                            <span
                              data-otto-thread-source="canvas"
                              className="shrink-0 rounded-[5px] border border-border px-1 text-[10px] leading-[15px] font-normal text-muted-foreground/80"
                            >
                              {PRODUCT_VOCABULARY.canvas}
                            </span>
                          )}
                          {dot && (
                            <span
                              className={`inline-block size-[7px] shrink-0 rounded-full ${dot}`}
                              aria-hidden
                            />
                          )}
                          <span className="min-w-0 truncate">{thread.title}</span>
                          {opening && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">Opening…</span>}
                        </Button>
                        {/* 悬停/聚焦/已置顶才现身 —— 与导轨原来的密度一致,不是常驻的第三排按钮。 */}
                        <div
                          data-otto-thread-list-actions={thread.id}
                          className={`absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 ${pinned ? "opacity-100" : ""}`}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-[22px] rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label={pinned ? `Unpin ${thread.title}` : `Pin ${thread.title}`}
                            title={pinned ? "Unpin conversation" : "Pin conversation"}
                            onClick={(e) => { e.stopPropagation(); onSetThreadPinned(thread.id, !pinned); }}
                          >
                            <Pin className="size-3.5" fill={pinned ? "currentColor" : "none"} aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-[22px] rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label={`Rename ${thread.title}`}
                            title="Rename conversation"
                            onClick={(e) => { e.stopPropagation(); onRenameThread(thread.id); }}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-[22px] rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${thread.title}`}
                            title="Delete conversation"
                            onClick={(e) => { e.stopPropagation(); onDeleteThread(thread.id); }}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

export default OttoThreadList;
