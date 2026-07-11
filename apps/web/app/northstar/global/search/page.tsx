/* @nsPage district="全局横切" page="search" status="draft"
   sources="GOAL A3(左栏 Search)" approvedAt="" pr="" */
"use client";

/**
 * 全局搜索 — 从任何页找到自己的项目 / 会话 / 生成历史
 *
 * 清单要素:命令面板式搜索;范围以 GOAL A3 为界(Projects / History / Chat),
 * 不发明全站对象搜索。规格 = §F6 面板 / §FB5 overlay(⌘K,scrim = 唯一获批模糊)/
 * §FB7 骨架 / §V4 过滤空态 / §N8(⌘K 预留给命令面板 —— 就是这一页)。
 * 陈列面:嵌入式面板(可打字、可键走)+ ⌘K overlay 形态。
 */

import * as React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { DemoFrame } from "@/components/northstar/global/demo";
import { SearchPalette } from "@/components/northstar/global/search-palette";

export default function Page() {
  const [overlayOpen, setOverlayOpen] = React.useState(false);

  // §N8:⌘K 全城预留给命令面板 — 本页即该面板,原型内演示这条绑定。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlayOpen((v) => !v);
      }
      if (e.key === "Escape") setOverlayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="全局搜索"
        subtitle="从任何页找到自己的项目、会话与生成历史。范围以 GOAL A3 为界:Projects / History / Chat,三组之外不发明。"
        meta={["GOAL A3", "⌘K"]}
      />

      <h2 className="mt-8 text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
        命令面板(嵌入陈列,可打字)
      </h2>
      <p className="mt-1 max-w-[680px] text-sm text-muted-foreground">
        空词 = Recent;打字 300ms 防抖后按三组给结果(查询中两条骨架行,永不 spinner);
        无结果一句话空态。↑↓ 走行,Enter 打开,Esc 先清词再关面板(一次剥一层)。
        试搜 &ldquo;merdeka&rdquo;、&ldquo;croissant&rdquo; 或 &ldquo;campaign&rdquo;。
      </p>
      <DemoFrame label="command palette · interactive" className="mt-4 max-w-[560px]">
        <SearchPalette className="h-[420px]" />
      </DemoFrame>

      <h2 className="mt-10 text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
        Overlay 形态(⌘K)
      </h2>
      <p className="mt-1 max-w-[680px] text-sm text-muted-foreground">
        真身形态:任何页按 ⌘K 唤起,浮在 --z-modal,scrim 是全城唯一获批的模糊(§FB5)。
        选中即跳转并关闭;Esc / 点 scrim 关闭。
      </p>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => setOverlayOpen(true)}>
          <Search strokeWidth={2} />
          Open search
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground">
            ⌘K
          </span>
        </Button>
      </div>

      {overlayOpen && (
        <div className="fixed inset-0 z-[100]">
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setOverlayOpen(false)}
            className="absolute inset-0 bg-[rgba(10,10,12,0.45)] backdrop-blur-[3px]"
          />
          <div
            role="dialog"
            aria-label="Search"
            className="absolute top-[15vh] left-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-3xl border border-border shadow-[var(--shadow-xl)]"
          >
            <SearchPalette
              autoFocus
              className="max-h-[52vh] min-h-[280px]"
              onClose={() => setOverlayOpen(false)}
            />
          </div>
        </div>
      )}

      <p className="mt-10 font-mono text-[11px] leading-[16px] tracking-[0.02em] text-muted-foreground">
        规则回执:范围三组为界(GOAL A3)· 查询中骨架永不 spinner(§FB7)· 过滤空态一句话(§V4)·
        hover / 键盘 active = --accent 永不 coral(§F6)· 本页零 coral(chrome 之外)。
      </p>

      <MockNote path="/northstar/global/search" />
    </div>
  );
}
