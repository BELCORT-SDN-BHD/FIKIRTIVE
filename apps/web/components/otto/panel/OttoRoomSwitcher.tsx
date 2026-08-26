"use client";

/**
 * OttoRoomSwitcher.tsx —— 标题那颗按钮打开的会话切换器(原型 L5449-5453 的 `.otto-rooms`,
 * 渲染逻辑 L6710-6713)。
 *
 * 它替掉的是上一版那份**盖住整段会话**的历史列表:切一条会话本来是一次「换个话题接着聊」,
 * 上一版却让商家先失去正在读的那一段,再从一整屏列表里找回来。原型给的是一层小小的浮层 ——
 * 搜索、Today / Recent 两组、每行一句「when · where」、一句尾注,以及底下那颗新对话。
 *
 * 整理会话的三件事(置顶 / 改名 / 删除)跟着搬进来了,项目那三件也一样(W2-11 把它们从
 * 被删掉的导轨救进面板;这一票换的是**列表的形状**,不是把刚救回来的能力再丢一次)。
 * 项目那一组是本文件与原型唯一的结构差异,理由就是这一句。
 *
 * 浮层不用 `ui/popover`:那颗是 Radix Portal,内容会挂到 `<body>` 上 —— 面板全屏接管时
 * 焦点陷阱与 `inert` 都是按「面板这棵子树」算的,portal 出去的东西正好落在陷阱外面。
 * 这一层是面板自己的一格,留在面板里。
 */

import * as React from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThreadStatusPill } from "@/components/otto/conversation/ConversationParts";
import { canvasHref } from "@/components/canvas/canvas-href";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatThreadDTO } from "@/lib/types";
import type { OttoNavProjectMeta } from "@/components/otto/otto-nav-model";
import { OTTO_ROOMS_NOTE, buildOttoRooms, type OttoRoom } from "./otto-rooms";

/** 浮层本身的 id —— 标题按钮用 `aria-controls` 指着它。 */
export const OTTO_ROOMS_ID = "otto-panel-rooms";

export interface OttoRoomSwitcherProps {
  projects: OttoNavProjectMeta[];
  threads: ChatThreadDTO[];
  activeThreadId: string | null;
  /** 分档相对哪一刻算 —— 由上层在**打开的那一下**读一次,不在渲染里读 `Date.now()`。 */
  now: number;
  /** 样张这一支的画布地址要多带一个 `fixture=r22`,否则点过去落在真实那一支上。 */
  fixture?: boolean;
  openingThreadId?: string | null;
  error?: string | null;
  onSelectThread: (thread: ChatThreadDTO) => void;
  onNewChat: () => void;
  onRenameThread: (id: string) => void;
  onSetThreadPinned: (id: string, pinned: boolean) => void;
  onDeleteThread: (id: string) => void;
  onRenameProject: (id: string) => void;
  onSetProjectPinned: (id: string, pinned: boolean) => void;
  onDeleteProject: (id: string) => void;
}

export function OttoRoomSwitcher({
  projects,
  threads,
  activeThreadId,
  now,
  fixture = false,
  openingThreadId = null,
  error = null,
  onSelectThread,
  onNewChat,
  onRenameThread,
  onSetThreadPinned,
  onDeleteThread,
  onRenameProject,
  onSetProjectPinned,
  onDeleteProject,
}: OttoRoomSwitcherProps) {
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  // 打开就把光标放进搜索框(原型 L6740):商家打开这一层多半是为了找一条,而不是为了看。
  React.useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const { today, recent } = buildOttoRooms({ threads, projects, query, now });
  const busy = openingThreadId !== null;
  const nothingMatched = threads.length > 0 && today.length === 0 && recent.length === 0;

  function row(room: OttoRoom) {
    const thread = room.thread;
    const pinned = Boolean(thread.pinnedAt);
    const active = thread.id === activeThreadId;
    return (
      <div key={thread.id} className="r22-room-row" data-canvas={room.canvas ? "" : undefined}>
        <Button
          unstyled
          type="button"
          data-otto-room={thread.id}
          {...(active ? { "aria-current": "true" as const } : {})}
          {...(thread.id === openingThreadId ? { "aria-busy": true } : {})}
          disabled={busy}
          onClick={() => onSelectThread(thread)}
          title={thread.title}
          data-active={active ? "" : undefined}
          className="r22-room-item"
        >
          {/* 状态在**标题那一行的右边**,不是另起一行:商家扫这份列表是竖着扫标题的,
              状态跟着标题走才扫得到。三态的判断在 `otto-thread-state.ts` 一处,面板头、
              画布、这里读的是同一句话。 */}
          <b className="r22-room-name">
            <span className="r22-room-name-text">{thread.title}</span>
            <ThreadStatusPill state={room.state} className="r22-room-state" />
          </b>
          <span className="r22-room-meta">{room.where ? `${room.when} · ${room.where}` : room.when}</span>
        </Button>
        {/* creation 的那几行行尾一条安静的路,回它自己那块板(裁决第 1 条)。它是一条
            **链接**不是按钮 —— 商家可能想在新标签页里开着那块板,继续在这里看别的线程。 */}
        {room.canvas ? (
          <Link
            data-otto-room-canvas={room.canvas.projectId}
            className="r22-room-canvas"
            href={fixture ? `${canvasHref(room.canvas.projectId)}&fixture=r22` : canvasHref(room.canvas.projectId)}
          >
            Open in Canvas
          </Link>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              unstyled
              type="button"
              aria-label={`${thread.title} controls`}
              title="Conversation controls"
              data-pinned={pinned ? "" : undefined}
              className="r22-room-more"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onSetThreadPinned(thread.id, !pinned)}>
                <Pin fill={pinned ? "currentColor" : "none"} aria-hidden />
                {pinned ? "Unpin conversation" : "Pin conversation"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRenameThread(thread.id)}>
                <Pencil aria-hidden />
                Rename conversation
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDeleteThread(thread.id)}>
                <Trash2 aria-hidden />
                Delete conversation
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <section id={OTTO_ROOMS_ID} data-otto-panel-rooms="" aria-label="Conversation switcher" className="r22-otto-rooms">
      <Input
        unstyled
        ref={searchRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search conversations"
        aria-label="Search conversations"
        className="r22-room-search"
      />

      {error && (
        <p role="alert" data-otto-panel-rooms-error="" className="r22-room-error">
          {error}
        </p>
      )}

      <div className="r22-room-list">
        {threads.length === 0 && (
          <p data-otto-panel-rooms-empty="" className="r22-room-note">
            Your conversations will show up here once you start one.
          </p>
        )}
        {nothingMatched && (
          <p data-otto-panel-rooms-nomatch="" className="r22-room-note">
            No conversation matches that search.
          </p>
        )}
        {today.length > 0 && (
          <div data-otto-panel-rooms-group="Today" className="r22-room-group">
            <p className="r22-room-group-label">Today</p>
            {today.map(row)}
          </div>
        )}
        {recent.length > 0 && (
          <div data-otto-panel-rooms-group="Recent" className="r22-room-group">
            <p className="r22-room-group-label">Recent</p>
            {recent.map(row)}
          </div>
        )}
        {projects.length > 0 && (
          <div data-otto-panel-rooms-group="Projects" className="r22-room-group">
            <p className="r22-room-group-label">Projects</p>
            {projects.map((project) => {
              const pinned = Boolean(project.pinnedAt);
              return (
                <div key={project.id} className="r22-room-row">
                  <span data-otto-room-project={project.id} className="r22-room-project">
                    {pinned && <Pin className="size-3 shrink-0" fill="currentColor" aria-hidden />}
                    <span className="truncate">{project.name}</span>
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        unstyled
                        type="button"
                        aria-label={`${project.name} controls`}
                        title="Project controls"
                        className="r22-room-more"
                      >
                        <MoreHorizontal className="size-3.5" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => onSetProjectPinned(project.id, !pinned)}>
                          <Pin fill={pinned ? "currentColor" : "none"} aria-hidden />
                          {pinned ? "Unpin project" : "Pin project"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onRenameProject(project.id)}>
                          <Pencil aria-hidden />
                          Rename project
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => onDeleteProject(project.id)}>
                          <Trash2 aria-hidden />
                          Delete project
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
        <p data-otto-panel-rooms-note="" className="r22-room-note">
          {OTTO_ROOMS_NOTE}
        </p>
      </div>

      <Button unstyled type="button" data-otto-panel-rooms-new="" disabled={busy} onClick={onNewChat} className="r22-room-new">
        New conversation
      </Button>
    </section>
  );
}
