"use client";

/**
 * 沉浸式 · 全局搜索(product surface)
 *
 * gallery 的 search 页把命令面板套进 DemoFrame 图纸框、并列演示两次(嵌入 + ⌘K overlay)——
 * 那是设计稿陈列。产品里搜索只有一个表面:一块干净的命令面板,占满内容 pane。
 *
 * 语料两源:① global 的 NS_SEARCH_ITEMS(Projects / History / Chat);② ENDGAME D2 新增
 * 「Otto chat」组 —— 直接搜这条连续对话流(store.streamFor()),因为 D1 废除了 HISTORY
 * 收纳,「找旧对话 = 全局流里搜」。选中 Otto 结果:有 context.href 深链回现场,否则进 /otto
 * 全屏读这条流。骨架行复用 global 的 SkeletonRow。
 *
 * 命令面板在产品里用 router.push 程序化跳转,外壳的 useKeepInsideImmersive 只拦 <a> 点击、
 * 拦不到 push,所以这里把 `/northstar/*` 目标改写成 `/northstar-immersive/*`,让选中即留在壳内。
 *
 * design-rules v3:§F6 面板(--popover · item hover=--accent 永不 coral)/ §FB7 骨架代替
 * spinner / §V4 过滤空态一句话 / §N8 键盘(↑↓ 走行、Enter 开、Esc 先清词)。零 coral、零后台。
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock, Folder, MessageSquare, Search, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkeletonRow } from "@/components/northstar/global/_fx";
import {
  NS_SEARCH_ITEMS,
  type NsSearchGroup,
  type NsSearchItem,
} from "@/components/northstar/global/_data";
import { streamFor, useStore } from "@/components/northstar/immersive/_store";

const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";
const OTTO_HREF = "/northstar-immersive/otto";

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

/** 归一化后的一行结果:两种语料(搜索项 / Otto 流消息)都投影成它,键盘导航统一遍历。 */
interface SearchRow {
  key: string;
  title: string;
  meta: string;
  icon: LucideIcon;
  href: string;
}
interface ResultGroup {
  label: string;
  rows: SearchRow[];
}

function itemMatches(item: NsSearchItem, q: string): boolean {
  const needle = q.toLowerCase();
  return item.title.toLowerCase().includes(needle) || item.meta.toLowerCase().includes(needle);
}

function itemRow(item: NsSearchItem): SearchRow {
  return {
    key: `it-${item.id}`,
    title: item.title,
    meta: item.meta,
    icon: GROUP_ICON[item.group],
    href: immersiveHref(item.href),
  };
}

export function ImmersiveSearch() {
  const router = useRouter();
  useStore(); // Otto 流是 live 的(dock / 各区 append):订阅它,搜得到刚发生的对话
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

  const groups = React.useMemo<ResultGroup[]>(() => {
    // 空词:Recent(确定性子集,混三组)
    if (!committedQ) {
      const recent = RECENT_IDS.map((id) => NS_SEARCH_ITEMS.find((i) => i.id === id))
        .filter((i): i is NsSearchItem => Boolean(i))
        .map(itemRow);
      return [{ label: "Recent", rows: recent }];
    }
    const needle = committedQ.toLowerCase();
    // ① Projects / History / Chat 三组(gallery 语料)
    const itemGroups: ResultGroup[] = GROUP_ORDER.map((g) => ({
      label: g,
      rows: NS_SEARCH_ITEMS.filter((i) => i.group === g && itemMatches(i, committedQ)).slice(0, 5).map(itemRow),
    })).filter((g) => g.rows.length > 0);
    // ② [wave-b] Otto 流内搜 —— 直接搜这条连续对话流(D2),找旧对话 = 全局流里搜(D1)
    const ottoRows: SearchRow[] = streamFor()
      .filter((m) => m.text.toLowerCase().includes(needle) || m.context.label.toLowerCase().includes(needle))
      .slice()
      .reverse() // 最新在前
      .slice(0, 5)
      .map((m) => ({
        key: `otto-${m.id}`,
        title: m.text,
        meta: m.context.label,
        icon: Sparkles,
        href: m.context.href ? immersiveHref(m.context.href) : OTTO_HREF,
      }));
    const ottoGroup: ResultGroup[] = ottoRows.length > 0 ? [{ label: "Otto chat", rows: ottoRows }] : [];
    return [...itemGroups, ...ottoGroup];
  }, [committedQ]);

  const flat = React.useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  const go = React.useCallback((row: SearchRow) => router.push(row.href), [router]);

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
      const row = flat[activeIdx];
      if (row) go(row);
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
        Find your projects, generation history and Otto chats — start typing.
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
            placeholder="Search projects, history and Otto chats"
            aria-label="Search projects, history and Otto chats"
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
                {g.rows.map((row) => {
                  runningIdx += 1;
                  const idx = runningIdx;
                  const active = idx === activeIdx;
                  const Icon = row.icon;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      data-idx={idx}
                      role="option"
                      aria-selected={active}
                      onClick={() => go(row)}
                      onMouseMove={() => setActiveIdx(idx)}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors duration-[120ms]",
                        active ? "bg-accent" : "hover:bg-accent",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.title}</span>
                      <span className="shrink-0 max-w-[40%] truncate text-xs font-medium text-muted-foreground tabular-nums">
                        {row.meta}
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
            Searches your projects, generation history and Otto chats
          </p>
          <p className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground">
            ↑↓ · Enter · Esc
          </p>
        </div>
      </div>
    </div>
  );
}
