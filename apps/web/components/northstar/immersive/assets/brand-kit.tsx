"use client";

/**
 * 沉浸式 · Brand kit —— 结构化品牌包(logo/色板/字体/语气/语言市场)。原生重建。
 * C-08 生成校验入口:Check recent visuals → 叙述条 → 结果落地 sweep(校验本身零花费)。
 * §L2 Settings 760;色板 hex = 用户品牌数据(数据级豁免),界面 chrome 全走 .gb token。
 * [wave-b] B-01 用法说明(Guidelines):每项资产「怎么用」的规则 + 例子。
 * [wave-b] B-03 品牌校验打分:结果附「像不像我的品牌」分 + 一键「更像我的品牌」。
 * [wave-b] B-12 品牌硬管控:Enforce 开关(违规生成结果标红不放行——原型层视觉态)。
 * [wave-b] B-13 多品牌 / Agency:左上角品牌切换器(切上下文,每品牌独立资料)。
 * [wave-b] B-15 品牌风格参考(轻量):用参考图匹配风格,生成默认贴近品牌视觉。
 */

import * as React from "react";
import Link from "next/link";
import { Check, Lock, Plus, ShieldCheck, TriangleAlert, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SweepIn } from "@/components/northstar/assets/_zone";
import { OttoNarrationBar } from "@/components/northstar/_shared";
import { BRAND_CHECK_STEPS, BRAND_KIT } from "@/components/northstar/assets/_data";
import { nsImage } from "@/components/northstar/_mock";
import { useStore, brandKitLogos, brandKitVoice, brandKitAddLogo, brandKitSaveVoice } from "../_store";
import { BRAND_CONTEXTS, BRAND_GUIDELINES, REFERENCE_STYLES } from "./data";
import { PageHeader, SectionTitle, AssetsNav, ASSETS_BASE } from "./kit";

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
  image: nsImage("bakery", 17),
};

/** B-03 校验结果(带打分:pass/warn) */
const CHECK_RESULTS = [
  { id: "bc-01", level: "pass" as const, text: "Logo clear space respected in all 12 recent visuals." },
  { id: "bc-02", level: "warn" as const, text: "1 visual uses an off-kit caption font." },
  { id: "bc-03", level: "pass" as const, text: "Colours stay within the kit palette." },
];

export function AssetsBrandKit() {
  useStore();
  const [brandId, setBrandId] = React.useState(BRAND_CONTEXTS[0].id);
  // 单源:logos + 已保存的 voice 读共享 store(跨页存活),不再私藏 useState 副本。
  const logos = brandKitLogos();
  const savedVoice = brandKitVoice();
  const [logoDialogOpen, setLogoDialogOpen] = React.useState(false);
  const [landedLogo, setLandedLogo] = React.useState<string | null>(null);
  const [check, setCheck] = React.useState<"idle" | "checking" | "done">("idle");
  const [enforce, setEnforce] = React.useState(false);
  const [refStyle, setRefStyle] = React.useState<string | null>("rs-01");

  // voice 是可编辑草稿(纯 UI 态,初值取自 store 的已保存值);Save 才写回 store。
  const [voice, setVoice] = React.useState<string>(savedVoice);
  const [savingVoice, setSavingVoice] = React.useState(false);
  const voiceTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (voiceTimer.current) window.clearTimeout(voiceTimer.current);
  }, []);

  const saveVoice = () => {
    setSavingVoice(true);
    voiceTimer.current = window.setTimeout(() => {
      brandKitSaveVoice(voice);
      setSavingVoice(false);
    }, 600);
  };

  const addLogo = () => {
    setLogoDialogOpen(false);
    brandKitAddLogo(NEW_LOGO);
    setLandedLogo(NEW_LOGO.id);
  };

  const activeBrand = BRAND_CONTEXTS.find((b) => b.id === brandId) ?? BRAND_CONTEXTS[0];
  const passCount = CHECK_RESULTS.filter((r) => r.level === "pass").length;
  const score = Math.round((passCount / CHECK_RESULTS.length) * 100);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Brand kit"
        subtitle="The structured facts of your brand. Otto checks new visuals against this."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* [wave-b] B-13:品牌切换器 —— 切上下文,每品牌独立 kit/library */}
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger className="h-9 w-[190px]" aria-label="Switch brand">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BRAND_CONTEXTS.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    {b.kind === "client" ? " · client" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AssetsNav />
            <Button variant="brand" size="sm" disabled={check === "checking"} onClick={() => setCheck("checking")}>
              {check === "checking" ? "Checking…" : "Check recent visuals"}
            </Button>
          </div>
        }
      />

      {activeBrand.kind === "client" && (
        <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-border bg-secondary/60 px-4 py-2.5 text-[13px] text-muted-foreground">
          <Lock className="size-4 shrink-0" strokeWidth={2} />
          You're editing a client brand. Its kit and library are kept separate from your own.
        </div>
      )}

      {/* §8c 叙述条 */}
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

      {/* C-08 校验结果 + B-03 打分 + 一键更像我的品牌 */}
      {check === "done" && (
        <SweepIn className="mt-4 rounded-[var(--radius-card)]">
          <section aria-label="Brand check results" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Brand check · 12 recent visuals</p>
                <p className="text-[11px] leading-4 text-muted-foreground">Checking is always free — no credits used.</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums text-foreground">{score}</p>
                <p className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">On brand</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss brand check results"
                onClick={() => setCheck("idle")}
                className="flex size-8 items-center justify-center rounded-[8px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
            {CHECK_RESULTS.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
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
                  <Button variant="brand" size="sm" asChild>
                    <Link href={`${ASSETS_BASE}/assets/library`}>Make it more on brand</Link>
                  </Button>
                )}
              </div>
            ))}
          </section>
        </SweepIn>
      )}

      <div className="mt-8 flex flex-col gap-8">
        {/* ── Logos ── */}
        <section aria-labelledby="bk-logos">
          <SectionTitle>Logos</SectionTitle>
          <div className="mt-3 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {logos.map((l) => {
              const card = (
                <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
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

        {/* ── Colours ── */}
        <section aria-labelledby="bk-colours">
          <SectionTitle>Colours</SectionTitle>
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

        {/* ── [wave-b] B-01 Guidelines(用法说明) ── */}
        <section aria-labelledby="bk-guidelines">
          <SectionTitle>How to use the brand</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">Otto follows these rules in everything it makes.</p>
          <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
            {BRAND_GUIDELINES.map((g, i) => (
              <div key={g.id} className={cn("flex flex-col gap-0.5 px-4 py-3", i > 0 && "border-t border-border")}>
                <p className="text-sm font-medium text-foreground">{g.rule}</p>
                <p className="text-[13px] leading-[18px] text-muted-foreground">{g.example}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Fonts ── */}
        <section aria-labelledby="bk-fonts">
          <SectionTitle>Fonts</SectionTitle>
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

        {/* ── Voice ── */}
        <section aria-labelledby="bk-voice">
          <SectionTitle>Voice</SectionTitle>
          <div className="mt-3 flex flex-col gap-2">
            <label htmlFor="bk-voice-text" className="text-[13px] leading-[18px] font-semibold text-foreground">
              How your brand talks
            </label>
            <Textarea id="bk-voice-text" value={voice} onChange={(e) => setVoice(e.target.value)} rows={3} />
            <p className="text-xs font-medium text-muted-foreground">Otto follows this in captions and replies.</p>
            <div className="flex justify-end">
              <Button size="sm" disabled={savingVoice || voice === savedVoice} onClick={saveVoice}>
                {savingVoice ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </section>

        {/* ── [wave-b] B-15 Reference style(轻量风格匹配) ── */}
        <section aria-labelledby="bk-refstyle">
          <SectionTitle>Style reference</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a look and Otto matches it by default — no model training needed.
          </p>
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {REFERENCE_STYLES.map((s) => {
              const active = refStyle === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setRefStyle((v) => (v === s.id ? null : s.id))}
                  aria-pressed={active}
                  className={cn(
                    "group flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-card text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    active ? "border-foreground" : "border-border hover:border-muted-foreground",
                  )}
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
                    <img src={s.thumb} alt={s.name} className="aspect-[4/3] w-full object-cover" />
                    {active && (
                      <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-foreground text-background">
                        <Check className="size-3.5" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 p-3">
                    <p className="text-sm font-semibold text-foreground">{s.name}</p>
                    <p className="text-[11px] leading-4 text-muted-foreground">{s.note}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── [wave-b] B-12 Enforce brand(硬管控) ── */}
        <section aria-labelledby="bk-enforce">
          <SectionTitle>Brand controls</SectionTitle>
          <div className="mt-3 flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-card px-4 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
              <ShieldCheck className="size-5 text-muted-foreground" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Enforce brand on generation</p>
              <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
                {enforce
                  ? "Off-brand results are flagged and held — good for when a teammate makes posts."
                  : "Otto suggests, but doesn't block. Turn on to stop off-brand results from going out."}
              </p>
            </div>
            <Switch checked={enforce} onCheckedChange={setEnforce} aria-label="Enforce brand on generation" />
          </div>
          {enforce && (
            <div className="mt-2 flex items-center gap-2 rounded-[12px] bg-warning-soft px-4 py-2.5 text-[13px] text-warning-soft-foreground">
              <TriangleAlert className="size-4 shrink-0" strokeWidth={2} />
              Off-brand results will be marked in red and can't be sent until fixed.
            </div>
          )}
        </section>

        {/* ── Languages & market ── */}
        <section aria-labelledby="bk-market">
          <SectionTitle>Languages and market</SectionTitle>
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

      {/* 上传 logo 对话框 */}
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
    </div>
  );
}
