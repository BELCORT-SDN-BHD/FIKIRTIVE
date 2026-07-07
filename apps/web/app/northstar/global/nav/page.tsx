/* @nsPage district="全局横切" page="nav" status="draft"
   sources="区划图·资产区(#129 分组导航);design-rules §10" approvedAt="" pr="" */
"use client";

/**
 * 全局导航骨架 — 全城的走路方式与页面外壳
 *
 * 清单要素:Create/Assets/Operate 三组侧栏(#129 分组税则)/ 当前区高亮 /
 * 余额(显示 credits)/ 移动端形态。规格 = design-rules §N2 六区解剖 +
 * §N3 行状态 + §L4 轨宽(240 桌面 · 0 收起 · 280 抽屉)+ §L6 ≤680 断点。
 * 陈列面:桌面壳(可点、可收起)+ 移动壳(52 顶栏 + 抽屉)。
 */

import * as React from "react";
import { Menu, PanelLeft, X } from "lucide-react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { DemoFrame, SketchBlock } from "@/components/northstar/global/demo";
import { ProductRail, RAIL_GROUPS } from "@/components/northstar/global/product-rail";
import { NS_BRAND } from "@/components/northstar/global/_data";

function toolLabel(id: string): string {
  for (const g of RAIL_GROUPS) {
    const t = g.tools.find((t) => t.id === id);
    if (t) return t.label;
  }
  return "Canvas";
}

/* ── 桌面壳:240 轨 + 内容 pane;收起 = 宽 0 + 34px 重开钮(§L2) ────── */
function DesktopShellDemo() {
  const [activeId, setActiveId] = React.useState("schedule");
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className="flex h-[560px]">
      {!collapsed && <ProductRail activeId={activeId} onSelect={setActiveId} onCollapse={() => setCollapsed(true)} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Open sidebar"
            className="absolute top-3 left-3 z-10 flex size-[34px] items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground shadow-[var(--shadow-sm)] transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
          >
            <PanelLeft className="size-4" strokeWidth={2} />
          </button>
        )}
        {/* 内容 pane 示意:页头解剖(§N6)+ 版面块 */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[880px] px-6 pt-6 pb-10">
            <div className="flex items-center gap-3" style={{ paddingLeft: collapsed ? 44 : 0 }}>
              <h2 className="text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">
                {toolLabel(activeId)}
              </h2>
              <span className="inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground">
                {NS_BRAND.name}
              </span>
            </div>
            <div aria-hidden className="mt-6 space-y-4">
              <SketchBlock className="h-24" />
              <div className="grid grid-cols-2 gap-4">
                <SketchBlock className="h-32" />
                <SketchBlock className="h-32" />
              </div>
              <SketchBlock className="h-16" />
              <SketchBlock className="h-16" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 移动壳(≤680):52px 顶栏 + 280 抽屉 + 无模糊 backdrop(§L4/§L6) ── */
function MobileShellDemo() {
  const [open, setOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState("schedule");

  return (
    <div className="relative mx-auto h-[560px] w-full max-w-[320px] overflow-hidden bg-background">
      <div className="flex h-[52px] items-center gap-3 border-b border-border bg-card px-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
        >
          <Menu className="size-5" strokeWidth={2} />
        </button>
        <OttoAvatar size={22} mood="idle" />
        <span className="text-[15px] font-bold tracking-[-0.01em] text-foreground">FIKIRTIVE</span>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground tabular-nums">
          <span aria-hidden className="size-3 rounded-full bg-brand" />
          {NS_BRAND.creditBalance.toLocaleString("en-MY")}
        </span>
      </div>

      <div aria-hidden className="space-y-3 p-4">
        <SketchBlock className="h-24" />
        <SketchBlock className="h-24" />
        <SketchBlock className="h-24" />
        <SketchBlock className="h-24" />
      </div>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(0,0,0,0.35)]"
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[88%] flex-col bg-background shadow-[var(--shadow-lg)]">
            <ProductRail
              activeId={activeId}
              onSelect={(id) => {
                setActiveId(id);
                setOpen(false);
              }}
              className="w-full flex-1 border-r-0"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="全局导航骨架"
        subtitle="全城的走路方式与页面外壳。六区固定顺序,Create → Assets → Operate 三组税则(#129)。"
        meta={["§N2 / §N3 / §L4", "live·revamp"]}
      />

      <h2 className="mt-8 text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">桌面壳(240 轨)</h2>
      <p className="mt-1 max-w-[680px] text-sm text-muted-foreground">
        点工具行换当前区(active = --secondary 填充 + 600,零 coral,无左条)。左上角可收起:
        宽度归 0,留 34px 重开钮,永远不出 mini 轨。轨内 coral 恰好三处:brand 云标 ·
        thread 行的 6px Otto 活动点 · 钉底的 14px credit 币。
      </p>
      <DemoFrame label="desktop shell · interactive" className="mt-4">
        <DesktopShellDemo />
      </DemoFrame>

      <h2 className="mt-10 text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
        移动壳(≤680:52px 顶栏 + 280 抽屉)
      </h2>
      <p className="mt-1 max-w-[680px] text-sm text-muted-foreground">
        顶栏只留三件事:菜单、身份、余额。抽屉是同一条轨(280 宽),backdrop 无模糊;
        系统返回先关抽屉再走页面(§N7)。
      </p>
      <DemoFrame label="mobile shell · interactive" className="mt-4" bodyClassName="bg-secondary/40">
        <MobileShellDemo />
      </DemoFrame>

      <p className="mt-3 font-mono text-[11px] leading-[16px] tracking-[0.02em] text-muted-foreground">
        规则回执:六区顺序固定 · New 是轨内唯一主动作(INK)· 分组标签 micro-mono ·
        active 与 hover 必须不同 token · 每区恰一 active 行(aria-current)。
      </p>

      <MockNote path="/northstar/global/nav" />
    </div>
  );
}
