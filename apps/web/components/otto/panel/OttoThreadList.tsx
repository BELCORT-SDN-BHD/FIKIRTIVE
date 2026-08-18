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
 * 与导轨画法的差别只有一处,而且是刻意的:这里没有置顶/改名/删除那几个行内控件。面板是
 * 「接着聊哪一条」的地方,整理会话仍在导轨(W2-11 收编导轨时再决定它们的落点)。少画一个
 * 按了没反应的按钮,好过摆一排。
 */

import * as React from "react";
import { Pin, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatThreadDTO } from "@/lib/types";
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
  return status === "working" ? "#f59e0b" : status === "failed" ? "#dc2626" : status === "done" ? "#16a34a" : null;
}

export function OttoThreadList({
  projects,
  threads,
  activeProjectId,
  activeThreadId,
  onSelectThread,
  onNewChat,
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
        onClick={onNewChat}
        className="h-9 w-full justify-start gap-2 rounded-[10px] px-3 text-[13px] font-medium"
      >
        <SquarePen className="size-4 shrink-0" strokeWidth={1.9} aria-hidden />
        New chat
      </Button>

      {error && (
        <div
          role="alert"
          data-otto-thread-list-error=""
          className="rounded-[10px] bg-error-soft px-2.5 py-1.5 text-[12px] text-[var(--error-soft-foreground)]"
        >
          {error}
        </div>
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
        return (
          <div key={project.id} data-otto-thread-list-project={project.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/70 uppercase">
              {project.pinnedAt && <Pin className="size-3 shrink-0" fill="currentColor" aria-hidden />}
              <span className="truncate">{project.name}</span>
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
                    const dot = statusDot(thread.status);
                    return (
                      <Button
                        key={thread.id}
                        type="button"
                        variant="ghost"
                        data-otto-thread-list-thread={thread.id}
                        {...(active ? { "aria-current": "true" as const } : {})}
                        {...(opening ? { "aria-busy": true } : {})}
                        disabled={openingThreadId !== null}
                        onClick={() => onSelectThread(thread)}
                        title={thread.title}
                        className={`h-auto w-full justify-start gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] ${
                          active ? "bg-secondary font-semibold text-foreground" : "font-normal text-muted-foreground"
                        }`}
                      >
                        {thread.pinnedAt && <Pin className="size-3 shrink-0" fill="currentColor" aria-hidden />}
                        {dot && (
                          <span
                            className="inline-block size-[7px] shrink-0 rounded-full"
                            style={{ background: dot }}
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0 truncate">{thread.title}</span>
                        {opening && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">Opening…</span>}
                      </Button>
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
