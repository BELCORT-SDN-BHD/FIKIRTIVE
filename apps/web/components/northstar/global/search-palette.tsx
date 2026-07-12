"use client";

/**
 * 北极星原型 · 全局横切区 — 全局搜索命令面板(GOAL A3:Projects / History / Chat)
 *
 * design-rules v3:§F6 面板配方(--popover · item 36 · hover=--accent 永不 coral)/
 * §F2 输入态(打字面永远平静)/ §FB7 骨架代替 spinner / §V4 过滤空态一句话 /
 * §N8 键盘(↑↓ 走行、Enter 开、Esc 每按剥一层:先清词再关面板)。
 * 范围铁律:只搜三组(GOAL A3 为界),不发明全站对象搜索。
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Folder,
  MessageSquare,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SkeletonRow } from "./_fx";
import { NS_SEARCH_ITEMS, type NsSearchGroup, type NsSearchItem } from "./_data";

const GROUP_ORDER: NsSearchGroup[] = ["Projects", "History", "Chat"];

const GROUP_ICON: Record<NsSearchGroup, LucideIcon> = {
  Projects: Folder,
  History: Clock,
  Chat: MessageSquare,
};

/** 空词时的「Recent」清单(确定性子集,混三组) */
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

export interface SearchPaletteProps {
  /** overlay 形态时提供:Esc(词已空时)/ 选中后关闭 */
  onClose?: () => void;
  /** 首次挂载自动聚焦(overlay 形态) */
  autoFocus?: boolean;
  className?: string;
}

export function SearchPalette({ onClose, autoFocus = false, className }: SearchPaletteProps) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [committedQ, setCommittedQ] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // §F4:异步查询防抖(演示 300ms);查询中 = 两条骨架行,永不 spinner。
  // loading 是纯派生态(typed query 尚未 commit 即「查询中」),不再在 effect 里同步 setState——
  // 消掉 set-state-in-effect;debounce 只负责把 committedQ 追上并把高亮归零。
  const loading = q.trim() !== committedQ;
  React.useEffect(() => {
    if (q.trim() === committedQ) return;
    const t = window.setTimeout(() => {
      setCommittedQ(q.trim());
      setActiveIdx(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, committedQ]);

  const groups = React.useMemo(() => buildGroups(committedQ), [committedQ]);
  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const go = React.useCallback(
    (item: NsSearchItem) => {
      onClose?.();
      router.push(item.href);
    },
    [onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (activeIdx + dir + flat.length) % flat.length;
      setActiveIdx(next);
      listRef.current
        ?.querySelector(`[data-idx="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIdx];
      if (item) go(item);
    } else if (e.key === "Escape") {
      // §N8:一次剥一层 — 有词先清词,词空才轮到面板
      if (q) {
        e.preventDefault();
        e.stopPropagation();
        setQ("");
      } else if (onClose) {
        e.preventDefault();
        onClose();
      }
    }
  };

  let runningIdx = -1;

  return (
    <div className={cn("flex min-w-0 flex-col bg-popover", className)} onKeyDown={onKeyDown}>
      {/* 输入行:面板内无边框输入,下沿 hairline;焦点环由外层 frame 承担 */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
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
  );
}
