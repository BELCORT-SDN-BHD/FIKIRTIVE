/* @nsPage district="全局横切" page="otto-dock" status="draft"
   sources="宪法 11 v2.6④;design-rules §8d" approvedAt="" pr="" */
"use client";

/**
 * Otto dock(常驻)— 全态陈列 + 演练场
 *
 * 清单要素:48px 收起圆点 + coral 徽点 / 320px 展开面板(叙述条 + 动作历史
 * deep-link + Open Otto)/ 移动端 bottom sheet。规格 = design-rules §8d/§O6。
 * 本页是 dock 的 design contract 陈列面:逐态摆开 + 一个可互动演练场
 * (brand 按钮唤 Otto 开工 → 徽点脉冲 → 叙述条走步 → 完成落行)。
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { DemoFrame, SketchBlock } from "@/components/northstar/global/demo";
import { DemoDock, DockButton, DockPanel, MobileDockDemo } from "@/components/northstar/global/demo-dock";
import { NS_NARRATION_STEPS, NS_OTTO_ACTIONS } from "@/components/northstar/_mock";
import { type NsOttoAction } from "@/components/northstar/global/_data";

export default function Page() {
  /* ── 演练场状态机:idle → working(叙述条走步)→ 完成(unseen 徽点 + 新行落地) ── */
  const [working, setWorking] = React.useState(false);
  const [stepIdx, setStepIdx] = React.useState(0);
  const [unseen, setUnseen] = React.useState(false);
  const [justLanded, setJustLanded] = React.useState(false);
  const [actions, setActions] = React.useState<NsOttoAction[]>(NS_OTTO_ACTIONS);
  const [hasCta, setHasCta] = React.useState(false);

  React.useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => {
      setStepIdx((i) => {
        if (i + 1 < NS_NARRATION_STEPS.length) return i + 1;
        window.clearInterval(t);
        // 完成:≤400ms 内落定(§8c),新动作行落进历史
        window.setTimeout(() => {
          setWorking(false);
          setUnseen(true);
          setJustLanded(true);
          setActions((a) => [
            { id: `oa-live-${Date.now()}`, text: "Prepped tomorrow's posts for review", at: "just now" },
            ...a,
          ]);
        }, 400);
        return i;
      });
    }, 1600);
    return () => window.clearInterval(t);
  }, [working]);

  const askOtto = () => {
    if (working) return;
    setStepIdx(0);
    setUnseen(false);
    setJustLanded(false);
    setWorking(true);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Otto dock"
        subtitle="Otto 随时一步可唤起、工作可见、永不抢主场。每张屏都带它(Otto home 除外)。"
        meta={["§8d / §O6", "z = --z-dock 70"]}
      />

      {/* ── 全态陈列 ── */}
      <h2 className="mt-8 text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">全态陈列</h2>
      <p className="mt-1 max-w-[680px] text-sm text-muted-foreground">
        徽点是三态的:隐藏(idle)· 脉冲(后台工作中)· 静止(有完成未看的工作,展开即清)。
        展开面板 header = 叙述条解剖;动作行中性零 coral,coral 在 deep-link 目的地的 sweep 上。
      </p>

      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
        <DemoFrame label="收起 · idle(徽点隐藏)" bodyClassName="flex h-40 items-end justify-end p-4">
          <DockButton mood="idle" badge="none" />
        </DemoFrame>
        <DemoFrame label="收起 · working(coral 徽点 2s 脉冲)" bodyClassName="flex h-40 items-end justify-end p-4">
          <DockButton mood="thinking" badge="pulse" narration="Generating storyboard" />
        </DemoFrame>
        <DemoFrame label="收起 · 完成未看(徽点静止)" bodyClassName="flex h-40 items-end justify-end p-4">
          <DockButton mood="idle" badge="steady" />
        </DemoFrame>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DemoFrame label="展开 · idle(动作历史 + Open Otto)" bodyClassName="flex justify-center bg-secondary/40 p-4">
          <DockPanel actions={NS_OTTO_ACTIONS} />
        </DemoFrame>
        <DemoFrame label="展开 · working(叙述条 + gen bar)" bodyClassName="flex justify-center bg-secondary/40 p-4">
          <DockPanel working narration="Drafting campaign posts…" actions={NS_OTTO_ACTIONS} />
        </DemoFrame>
        <DemoFrame label="展开 · working(数步计数器 2/5)" bodyClassName="flex justify-center bg-secondary/40 p-4">
          <DockPanel working narration="Generating 5 variants…" counter="2/5" actions={NS_OTTO_ACTIONS} />
        </DemoFrame>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DemoFrame label="展开 · 空态" bodyClassName="flex justify-center bg-secondary/40 p-4">
          <DockPanel actions={[]} />
        </DemoFrame>
        <DemoFrame label="移动端 · 底栏上方 12px → 全宽 bottom sheet(点圆点)" className="lg:col-span-2" bodyClassName="bg-secondary/40">
          <MobileDockDemo actions={NS_OTTO_ACTIONS} />
        </DemoFrame>
      </div>

      {/* ── 演练场 ── */}
      <h2 className="mt-10 text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">演练场</h2>
      <p className="mt-1 max-w-[680px] text-sm text-muted-foreground">
        唤 Otto 开工,看完整一循环:徽点脉冲 → 叙述条走步 → 完成后新动作行落进历史、徽点静止直到你展开。
        右下主 CTA 开关演示「dock 永不盖主 CTA:dock 让位,CTA 不动」。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {/* coral 预算:全屏唯一 brand 按钮 —— 按下即 Otto 开工(§O4) */}
        <Button variant="brand" size="sm" onClick={askOtto} disabled={working}>
          {working ? "Otto is working…" : "Ask Otto to prep tomorrow's posts"}
        </Button>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Switch checked={hasCta} onCheckedChange={setHasCta} />
          页面带右下主 CTA
        </label>
      </div>

      <DemoFrame label="live playground" className="mt-4" bodyClassName="h-[420px]">
        {/* 版面示意:一张普通列表页 */}
        <div aria-hidden className="flex h-full flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <SketchBlock className="h-7 w-40" />
            <div className="flex-1" />
            <SketchBlock className="h-8 w-24" />
          </div>
          <SketchBlock className="h-16" />
          <SketchBlock className="h-16" />
          <SketchBlock className="h-16" />
          <SketchBlock className="h-16" />
        </div>
        {hasCta && (
          <Button size="sm" className="absolute right-4 bottom-4">
            New post
          </Button>
        )}
        <DemoDock
          working={working}
          narration={working ? NS_NARRATION_STEPS[Math.min(stepIdx, NS_NARRATION_STEPS.length - 1)] : undefined}
          actions={actions}
          unseen={unseen}
          onSeen={() => setUnseen(false)}
          liftForCta={hasCta}
          landNewest={justLanded}
        />
      </DemoFrame>

      <p className="mt-3 font-mono text-[11px] leading-[16px] tracking-[0.02em] text-muted-foreground">
        规则回执:一屏一 dock · 展开不暂停工作 · Esc/外点收起 · 收起态永远可达 ·
        Otto home 整页即 Otto,dock 隐藏(§O3)。
      </p>

      <MockNote path="/northstar/global/otto-dock" />
    </div>
  );
}
