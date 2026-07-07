/* @nsPage district="资产区" page="brand-kit" status="draft"
   sources="harmony-01 #2;C-08 判决" approvedAt="" pr="" */
"use client";

/**
 * 品牌包页(Brand kit)— 结构化品牌包,与自由态记忆互补(P1 · 未建)
 * 清单要素:logo / 色板 / 字体 / 语气 / 语言市场、生成校验入口(C-08:
 * Check recent visuals → 叙述条 → 校验结果落地 sweep)。
 * 布局:§L2 Settings 型单列 760。色板 hex 是用户品牌数据(数据级豁免,
 * 见 _data.ts 文件头注记),界面 chrome 仍全走 .gb token。
 * Otto 出场(§O4):校验是 Otto 工作 → 一颗 brand 键 + 叙述条;结果行零 coral。
 */

import * as React from "react";
import { Check, Plus, TriangleAlert, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DemoStateBar,
  ErrorPanel,
  Skeleton,
  SweepIn,
  type DemoState,
} from "@/components/northstar/assets/_zone";
import {
  BRAND_CHECK_RESULTS,
  BRAND_CHECK_STEPS,
  BRAND_KIT,
} from "@/components/northstar/assets/_data";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { nsPlaceholder } from "@/components/northstar/_mock";

interface LogoEntry {
  id: string;
  name: string;
  note: string;
  image: string;
}

const NEW_LOGO: LogoEntry = {
  id: "logo-03",
  name: "Stamp mark",
  note: "Round stamp for packaging",
  image: nsPlaceholder("Stamp", 300, 300, "kopi"),
};

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [logos, setLogos] = React.useState<LogoEntry[]>([...BRAND_KIT.logos]);
  const [logoDialogOpen, setLogoDialogOpen] = React.useState(false);
  const [landedLogo, setLandedLogo] = React.useState<string | null>(null);

  /** C-08 生成校验:idle → checking(叙述条)→ done(结果落地 sweep) */
  const [check, setCheck] = React.useState<"idle" | "checking" | "done">("idle");

  /** 语气:dirty → Save 可用;保存后回到 clean(值本身就是反馈,零 toast) */
  const [voice, setVoice] = React.useState<string>(BRAND_KIT.voice);
  const [savedVoice, setSavedVoice] = React.useState<string>(BRAND_KIT.voice);
  const [savingVoice, setSavingVoice] = React.useState(false);
  const voiceTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (voiceTimer.current) window.clearTimeout(voiceTimer.current);
  }, []);

  const saveVoice = () => {
    setSavingVoice(true);
    voiceTimer.current = window.setTimeout(() => {
      setSavedVoice(voice);
      setSavingVoice(false);
    }, 600);
  };

  const addLogo = () => {
    setLogoDialogOpen(false);
    setLogos((prev) => (prev.some((l) => l.id === NEW_LOGO.id) ? prev : [...prev, NEW_LOGO]));
    setLandedLogo(NEW_LOGO.id);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Brand kit"
        subtitle="The structured facts of your brand. Otto checks new visuals against this."
        meta={[BRAND_KIT.brandName]}
        actions={
          /* C-08 校验入口:按下即开始 Otto 工作 → 允许 brand 键(§O4 一屏至多一颗) */
          <Button
            variant="brand"
            size="sm"
            disabled={check === "checking"}
            onClick={() => setCheck("checking")}
          >
            {check === "checking" ? "Checking…" : "Check recent visuals"}
          </Button>
        }
      />

      {/* §8c 叙述条:一屏一条,钉在 Otto 正在动的面顶部 */}
      {check === "checking" && (
        <OttoNarrationBar
          key="brand-check"
          steps={BRAND_CHECK_STEPS}
          stepMs={1300}
          counter
          onSettle={() => setCheck("done")}
          className="mt-4 self-start"
        />
      )}

      {/* 校验结果:落地 sweep 一次;行内容零 coral(结果不是装饰) */}
      {check === "done" && (
        <SweepIn className="mt-4 rounded-[var(--radius-card)]">
          <section
            aria-label="Brand check results"
            className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                Brand check · 12 recent visuals
              </p>
              <button
                type="button"
                aria-label="Dismiss brand check results"
                onClick={() => setCheck("idle")}
                className="flex size-8 items-center justify-center rounded-[8px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
            {BRAND_CHECK_RESULTS.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                {/* text-success 未注册(T5 已知 drift)→ 用已注册的 soft-foreground 对 */}
                {r.level === "pass" ? (
                  <Check className="size-4 shrink-0 text-success-soft-foreground" strokeWidth={2} />
                ) : (
                  <TriangleAlert className="size-4 shrink-0 text-warning" strokeWidth={2} />
                )}
                <p
                  className={cn(
                    "min-w-0 flex-1 text-sm leading-[20px]",
                    r.level === "warn" ? "text-warning-soft-foreground" : "text-foreground",
                  )}
                >
                  {r.text}
                </p>
                {r.level === "warn" && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/northstar/assets/library">Open Library</Link>
                  </Button>
                )}
              </div>
            ))}
          </section>
        </SweepIn>
      )}

      {/* 三态齐全(harmony-06 §一):header 永远在场,状态活在 body */}
      <div className="mt-8 flex flex-1 flex-col">
        {demo === "loading" && (
          <div role="status" aria-label="Loading" className="flex flex-col gap-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-3">
                <Skeleton shimmer={i < 3} className="h-4 w-32" />
                <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
              </div>
            ))}
          </div>
        )}

        {demo === "empty" && (
          <EmptyState
            icon={Upload}
            title="No brand kit yet"
            body="Start with your logo and colours. Otto uses them in everything it makes."
            action={
              <Button size="sm" onClick={() => setDemo("normal")}>
                Add logo
              </Button>
            }
          />
        )}

        {demo === "error" && (
          <ErrorPanel message="Couldn't load your brand kit. Try again." onRetry={() => setDemo("normal")} />
        )}

        {demo === "normal" && (
          <div className="flex flex-col gap-8">
            {/* ── Logos ── */}
            <section aria-labelledby="bk-logos">
              <h2 id="bk-logos" className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
                Logos
              </h2>
              <div className="mt-3 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {logos.map((l) => {
                  const card = (
                    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
                      <img src={l.image} alt={l.name} className="aspect-[8/5] w-full object-cover" />
                      <div className="flex flex-col gap-0.5 p-4">
                        <p className="text-sm font-semibold text-foreground">{l.name}</p>
                        <p className="text-xs text-muted-foreground">{l.note}</p>
                      </div>
                    </div>
                  );
                  return landedLogo === l.id ? (
                    <SweepIn key={`${l.id}-landed`} sweep={false} className="rounded-[var(--radius-card)]">
                      {card}
                    </SweepIn>
                  ) : (
                    <div key={l.id}>{card}</div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setLogoDialogOpen(true)}
                  className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <Plus className="size-5" strokeWidth={2} />
                  <span className="text-sm font-medium">Add logo</span>
                </button>
              </div>
            </section>

            {/* ── Colours(用户品牌数据;swatch 的 hex 不是 UI token) ── */}
            <section aria-labelledby="bk-colours">
              <h2 id="bk-colours" className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
                Colours
              </h2>
              <div className="mt-3 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {BRAND_KIT.colours.map((c) => (
                  <div key={c.id} className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                    <div className="h-16 w-full border-b border-border" style={{ backgroundColor: c.hex }} />
                    <div className="flex flex-col gap-0.5 p-3">
                      <p className="text-sm font-semibold text-foreground">{c.name}</p>
                      <p className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        {c.hex}
                      </p>
                      <p className="text-xs text-muted-foreground">{c.use}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Fonts ── */}
            <section aria-labelledby="bk-fonts">
              <h2 id="bk-fonts" className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
                Fonts
              </h2>
              <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                {BRAND_KIT.fonts.map((f, i) => (
                  <div key={f.id} className={cn("flex flex-col gap-1 px-4 py-3", i > 0 && "border-t border-border")}>
                    <div className="flex items-baseline gap-2">
                      <p className="text-xs font-medium text-muted-foreground">{f.role}</p>
                      <p className="text-sm font-semibold text-foreground">{f.family}</p>
                    </div>
                    <p className="truncate text-sm leading-[20px] text-muted-foreground">{f.sample}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Voice(§F1 字段解剖:label → control → help) ── */}
            <section aria-labelledby="bk-voice">
              <h2 id="bk-voice" className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
                Voice
              </h2>
              <div className="mt-3 flex flex-col gap-2">
                <label htmlFor="bk-voice-text" className="text-[13px] leading-[18px] font-semibold text-foreground">
                  How your brand talks
                </label>
                <Textarea
                  id="bk-voice-text"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  rows={3}
                />
                <p className="text-xs font-medium text-muted-foreground">
                  Otto follows this in captions and replies.
                </p>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={savingVoice || voice === savedVoice}
                    onClick={saveVoice}
                  >
                    {savingVoice ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </section>

            {/* ── Languages & market ── */}
            <section aria-labelledby="bk-market">
              <h2 id="bk-market" className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
                Languages and market
              </h2>
              <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                <div className="flex items-center gap-3 px-4 py-3">
                  <p className="w-24 shrink-0 text-xs font-medium text-muted-foreground">Languages</p>
                  <div className="flex flex-wrap gap-1.5">
                    {BRAND_KIT.languages.map((lang) => (
                      <Badge key={lang}>{lang}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 border-t border-border px-4 py-3">
                  <p className="w-24 shrink-0 text-xs font-medium text-muted-foreground">Market</p>
                  <p className="text-sm font-medium text-foreground">{BRAND_KIT.market}</p>
                </div>
                <div className="flex items-center gap-3 border-t border-border px-4 py-3">
                  <p className="w-24 shrink-0 text-xs font-medium text-muted-foreground">Currency</p>
                  <p className="text-sm font-medium text-foreground">{BRAND_KIT.currency}</p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* 上传 logo 对话框(M 号;拖放区为原型示意;人类动作 → 降落零 sweep) */}
      <Dialog open={logoDialogOpen} onOpenChange={setLogoDialogOpen}>
        <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Add logo</DialogTitle>
            <DialogDescription>PNG or SVG with a transparent background works best.</DialogDescription>
          </DialogHeader>
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-secondary/50 text-center">
            <Upload className="size-5 text-muted-foreground" strokeWidth={2} />
            <p className="text-sm text-muted-foreground">Drop a file here, or browse</p>
            <p className="text-xs text-muted-foreground">stamp-mark.svg selected</p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setLogoDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addLogo}>Add logo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/assets/brand-kit" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}
