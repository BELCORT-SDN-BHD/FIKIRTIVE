"use client";

/**
 * 沉浸式 · 全局搜索(product surface)
 *
 * gallery 的 search 页把命令面板套进 DemoFrame 图纸框、并列演示两次(嵌入 + ⌘K overlay)——
 * 那是设计稿陈列。产品里搜索只有一个表面:一块干净的命令面板,占满内容 pane。
 *
 * 复用口径(照 account-ops 先例):语料直接派生自 global 的 NS_SEARCH_ITEMS(GOAL A3 三组:
 * Projects / History / Chat),骨架行复用 global 的 SkeletonRow。唯一改动是导航前缀 ——
 * 命令面板在产品里用 router.push 程序化跳转,外壳的 useKeepInsideImmersive 只拦 <a> 点击、
 * 拦不到 push,所以这里把 `/northstar/*` 目标改写成 `/northstar-immersive/*`,让选中即留在壳内。
 *
 * design-rules v3:§F6 面板(--popover · item hover=--accent 永不 coral)/ §FB7 骨架代替
 * spinner / §V4 过滤空态一句话 / §N8 键盘(↑↓ 走行、Enter 开、Esc 先清词)。零 coral、零后台。
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock, Folder, MessageSquare, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkeletonRow } from "@/components/northstar/global/_fx";
import {
  NS_SEARCH_ITEMS,
  type NsSearchGroup,
  type NsSearchItem,
} from "@/components/northstar/global/_data";

const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";

/** 把画廊语料的 `/northstar/*` 目标改写成沉浸式路由(其余原样)。 */
function immersiveHref(href: string): string {
  return href.startsWith(GALLERY_PREFIX) ? IMMERSIVE_PREFIX + href.slice(GALLERY_PREFIX.length) : href;
}

const GROUP_ORDER: NsSearchGroup[] = ["Projects", "History", "Chat"];

const GROUP_ICON: Record<NsSearchGroup, LucideIcon> = {
  Projects: Folder,
  History: Clock,
  Chat: MessageSquare,
};

/** 空词时的「Recent」清单(确定性子集,混三组;照 search-palette 先例) */
const RECENT_IDS = ["sc-1", "sh-1", "sp-01", "sh-2", "sc-2"];

function matches(item: NsSearchItem, q: string): boolean {
  const needle = q.toLowerCase();
  return item.title.toLowerCase().includes(needle) || item.meta.toLowerCase().includes(needle);
}

interface ResultGroup {
  label: string;
  items: NsSearchItem[];
}

function buildGroups(q: string): ResultGroup[] {
  if (!q) {
    const recent = RECENT_IDS.map((id) => NS_SEARCH_ITEMS.find((i) => i.id === id)).filter(
      (i): i is NsSearchItem => Boolean(i),
    );
    return [{ label: "Recent", items: recent }];
  }
  return GROUP_ORDER.map((g) => ({
    label: g,
    items: NS_SEARCH_ITEMS.filter((i) => i.group === g && matches(i, q)).slice(0, 5),
  })).filter((g) => g.items.length > 0);
}

export function ImmersiveSearch() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [committedQ, setCommittedQ] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // §F4:异步查询防抖(300ms);查询中 = 两条骨架行,永不 spinner。
  React.useEffect(() => {
    if (q.trim() === committedQ) return;
    setLoading(true);
    const t = window.setTimeout(() => {
      setCommittedQ(q.trim());
      setLoading(false);
      setActiveIdx(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, committedQ]);

  const groups = React.useMemo(() => buildGroups(committedQ), [committedQ]);
  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const go = React.useCallback(
    (item: NsSearchItem) => {
      router.push(immersiveHref(item.href));
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (activeIdx + dir + flat.length) % flat.length;
      setActiveIdx(next);
      listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIdx];
      if (item) go(item);
    } else if (e.key === "Escape") {
      // §N8:一次剥一层 — 有词先清词(产品里面板常驻,清空即止)
      if (q) {
        e.preventDefault();
        e.stopPropagation();
        setQ("");
      }
    }
  };

  let runningIdx = -1;

  return (
    <div className="mx-auto flex h-full w-full max-w-[720px] flex-col px-6 pt-6 pb-10">
      <h1 className="text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">Search</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Find your projects, generation history and chats — start typing.
      </p>

      {/* 命令面板:一个干净表面,占满剩余高度 */}
      <div
        className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-popover shadow-[var(--shadow-sm)]"
        onKeyDown={onKeyDown}
      >
        {/* 输入行 */}
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects, history and chats"
            aria-label="Search projects, history and chats"
            className="h-full w-full min-w-0 bg-transparent text-[15px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded-[8px] px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* 结果区 */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox" aria-label="Search results">
          {loading ? (
            <div className="space-y-2 p-2">
              <SkeletonRow className="h-9" />
              <SkeletonRow className="h-9" />
            </div>
          ) : flat.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] leading-[18px] text-muted-foreground">
              Nothing matches &ldquo;{committedQ}&rdquo;.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="pb-1">
                <div className="px-3 pt-2 pb-1 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  {g.label}
                </div>
                {g.items.map((item) => {
                  runningIdx += 1;
                  const idx = runningIdx;
                  const active = idx === activeIdx;
                  const Icon = GROUP_ICON[item.group];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-idx={idx}
                      role="option"
                      aria-selected={active}
                      onClick={() => go(item)}
                      onMouseMove={() => setActiveIdx(idx)}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors duration-[120ms]",
                        active ? "bg-accent" : "hover:bg-accent",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</span>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                        {item.meta}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* 页脚:范围声明 + 键盘提示 */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            Searches your projects, generation history and chats
          </p>
          <p className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground">
            ↑↓ · Enter · Esc
          </p>
        </div>
      </div>
    </div>
  );
}
