"use client";

/**
 * 沉浸式 · 工厂出片间 —— 原生重建(ENDGAME §五 一区)。收钱先锋 P1。
 * 主流水线:产品 → 模式 → (Money-shot 锁产品) → 风格 → Hook 生成器 → 变体矩阵 → 批量总价确认。
 * Wave B(13 条,逐处 [wave-b] 注释):Money Shot 保真 / 拍法扩容 / 编辑工具箱 / 表格批量 /
 * 品牌语气逆推 / 知识库防瞎编 / 受众改写 / 生成前品牌校验 / 整版广告一体 / 项目资产板 /
 * 发布前双重体检 / 交付凭证 / 自建模板。
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Check,
  FileText,
  Grid3x3,
  Layers,
  Link2,
  Lock,
  Mic,
  ShieldCheck,
  Ticket,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { NS_PRODUCTS, nsImage } from "@/components/northstar/_mock";
import { SectionLabel, SpendConfirmDialog, useCreateKeyframes } from "@/components/northstar/create/_create-ui";
import { IMMERSIVE_BASE } from "../_kit";
import { balance as getBalance, ottoWorking as setOttoWorking, spendCredits, studioLogGen, useStore } from "../_store";
import {
  STUDIO_AUDIENCES,
  STUDIO_BULK_TASKS,
  STUDIO_CREDITS_PER_VARIANT,
  STUDIO_EDIT_TOOLS,
  STUDIO_HOOKS,
  STUDIO_MODES,
  STUDIO_PLATFORMS,
  STUDIO_SIZES,
  STUDIO_STYLES,
} from "./data";

type CellKey = string; // `${platform}|${size}`
type BatchState = "idle" | "running" | "done";
type Tool = "batch" | "bulk";

export function StudioFactory() {
  useCreateKeyframes();
  useStore();
  const router = useRouter();
  const [tool, setTool] = React.useState<Tool>("batch");

  // 主流水线状态
  const [productId, setProductId] = React.useState(NS_PRODUCTS[5].id);
  const [modeId, setModeId] = React.useState(STUDIO_MODES[0].id);
  const [lockedShots, setLockedShots] = React.useState<number[]>([]); // [wave-b] money-shot 锁定的产品照片
  const [styleId, setStyleId] = React.useState(STUDIO_STYLES[0].id);
  const [hooks, setHooks] = React.useState<string[]>([]);
  const [hooksWorking, setHooksWorking] = React.useState(false);
  const [selectedHooks, setSelectedHooks] = React.useState<string[]>([]);
  const [audience, setAudience] = React.useState<string | null>(null); // [wave-b] 受众改写
  const [cells, setCells] = React.useState<CellKey[]>(["Instagram|4:5", "Instagram|9:16", "TikTok|9:16"]);
  const [batchAsk, setBatchAsk] = React.useState(false);
  const [batch, setBatch] = React.useState<BatchState>("idle");
  const [cellPct, setCellPct] = React.useState<Record<string, number>>({});
  const [preflight, setPreflight] = React.useState<"none" | "running" | "done">("none"); // [wave-b] 双重体检
  const [factsOpen, setFactsOpen] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [licenseOpen, setLicenseOpen] = React.useState(false);
  const [saveTplOpen, setSaveTplOpen] = React.useState(false);
  const [editTool, setEditTool] = React.useState<string | null>(null);
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const balance = getBalance();
  const product = NS_PRODUCTS.find((p) => p.id === productId) ?? NS_PRODUCTS[0];
  const mode = STUDIO_MODES.find((m) => m.id === modeId) ?? STUDIO_MODES[0];
  const variantCount = cells.length * Math.max(1, selectedHooks.length);
  const totalCredits = variantCount * STUDIO_CREDITS_PER_VARIANT;

  const generateHooks = () => {
    setHooksWorking(true);
    setHooks([]);
    const t = window.setTimeout(() => {
      setHooks([...STUDIO_HOOKS]);
      setSelectedHooks([STUDIO_HOOKS[0]]);
      setHooksWorking(false);
    }, 3400);
    timers.current.push(t);
  };

  const runPreflight = () => {
    setPreflight("running");
    const t = window.setTimeout(() => setPreflight("done"), 1800);
    timers.current.push(t);
  };

  const runBatch = (credits: number) => {
    spendCredits(credits, `${variantCount} variants · ${product.name}`, "Image");
    setOttoWorking(true, "Rendering variants…");
    studioLogGen(`Cutting ${variantCount} ad variants of ${product.name}. Failed ones aren't charged.`, "Factory");
    setBatch("running");
    cells.forEach((key, i) => {
      const t = window.setTimeout(() => {
        const iv = window.setInterval(() => {
          setCellPct((prev) => {
            const cur = prev[key] ?? 0;
            if (cur >= 100) {
              window.clearInterval(iv);
              return prev;
            }
            const next = { ...prev, [key]: Math.min(100, cur + 8) };
            if (next[key] === 100 && i === cells.length - 1) {
              window.setTimeout(() => {
                setBatch("done");
                setOttoWorking(false);
              }, 500);
            }
            return next;
          });
        }, 220);
        timers.current.push(iv);
      }, i * 900);
      timers.current.push(t);
    });
  };

  const toggleCell = (key: CellKey) => {
    if (batch !== "idle") return;
    setCells((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Factory"
        subtitle="From product to ready-to-run ads, one batch at a time."
        meta={[`${balance.toLocaleString()} credits`]}
        actions={
          <div className="flex rounded-[10px] border border-border bg-card p-0.5">
            {(["batch", "bulk"] as Tool[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
                className={cn(
                  "flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-[120ms]",
                  tool === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "batch" ? <Layers className="size-3.5" strokeWidth={2} /> : <Grid3x3 className="size-3.5" strokeWidth={2} />}
                {t === "batch" ? "Variant batch" : "Bulk grid"}
              </button>
            ))}
          </div>
        }
      />

      {/* [wave-b] 表格式批量生产(Jasper Grid + Canva Bulk):行=商品,列=生成任务 */}
      {tool === "bulk" ? (
        <BulkGrid />
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {/* ① 产品 */}
          <section>
            <SectionLabel>1 · Product</SectionLabel>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {NS_PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={productId === p.id}
                  onClick={() => setProductId(p.id)}
                  className={cn(
                    "w-40 shrink-0 overflow-hidden rounded-[14px] border text-left transition-colors duration-[120ms]",
                    productId === p.id ? "border-foreground" : "border-border hover:bg-accent",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image} alt={p.name} className="aspect-square w-full object-cover" />
                  <div className="p-2.5">
                    <p className="truncate text-[13px] font-semibold text-foreground">{p.name}</p>
                    <p className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">RM{p.priceMyr}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* ② 模式(Wave 1 可选;Wave 2/3 锁票可见 —— C-01 纪律) */}
          <section>
            <SectionLabel>2 · Mode</SectionLabel>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STUDIO_MODES.map((m) => {
                const locked = m.wave !== 1;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={locked}
                    aria-pressed={modeId === m.id}
                    onClick={() => setModeId(m.id)}
                    className={cn(
                      "relative flex flex-col gap-1 rounded-[14px] border p-4 text-left transition-colors duration-[120ms]",
                      locked ? "border-dashed border-border opacity-70" : modeId === m.id ? "border-foreground bg-secondary" : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      {locked && <Lock className="size-3.5 text-muted-foreground" strokeWidth={2} />}
                      {m.productLock && !locked && <BadgeCheck className="size-3.5 text-muted-foreground" strokeWidth={2} />}
                      {m.name}
                    </span>
                    <span className="text-xs leading-4 text-muted-foreground">{m.desc}</span>
                    {locked && (
                      <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] leading-4 font-medium tracking-[0.06em] text-muted-foreground">
                        <Ticket className="size-3" strokeWidth={2} />
                        Wave {m.wave} · upgrade ticket
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* [wave-b] Money Shot 级产品保真:先把产品从实拍照锁成资产,再合成场景 */}
          {mode.productLock && (
            <section>
              <SectionLabel>2b · Lock your product</SectionLabel>
              <p className="mt-1 text-xs text-muted-foreground">Pick 4–8 real photos. Otto keeps your packaging, logo and text true across every shot.</p>
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {Array.from({ length: 8 }, (_, i) => nsImage("bakery", i + 1)).map((src, i) => {
                  const on = lockedShots.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setLockedShots((prev) => (on ? prev.filter((x) => x !== i) : [...prev, i]))}
                      className={cn("relative overflow-hidden rounded-[10px] border-2 transition-colors", on ? "border-foreground" : "border-transparent hover:border-border")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Product photo ${i + 1}`} className="aspect-square w-full object-cover" />
                      {on && (
                        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                          <Check className="size-3" strokeWidth={2.5} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{lockedShots.length} locked{lockedShots.length < 4 ? " · pick at least 4" : " · product-true ready"}</p>
            </section>
          )}

          {/* ③ 风格 */}
          <section>
            <SectionLabel>3 · Style</SectionLabel>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STUDIO_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={styleId === s.id}
                  onClick={() => setStyleId(s.id)}
                  className={cn("overflow-hidden rounded-[14px] border text-left transition-colors duration-[120ms]", styleId === s.id ? "border-foreground" : "border-border hover:bg-accent")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumb} alt={s.name} className="aspect-[8/5] w-full object-cover" />
                  <div className="flex items-center justify-between p-2.5">
                    <span className="text-[13px] font-semibold text-foreground">{s.name}</span>
                    {styleId === s.id && <Check className="size-4 text-foreground" strokeWidth={2.2} />}
                  </div>
                </button>
              ))}
            </div>
            {/* [wave-b] 品牌语气逆推(Jasper Brand Voice)· [wave-b] 知识库引用防瞎编(Jasper KB) */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setVoiceOpen(true)}>
                <Mic className="size-3.5" strokeWidth={2} />
                Learn my voice
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setFactsOpen(true)}>
                <FileText className="size-3.5" strokeWidth={2} />
                Facts source
              </Button>
              <span className="text-xs text-muted-foreground">Free — keeps copy on-voice and stops made-up prices.</span>
            </div>
          </section>

          {/* ④ Hook 生成器 + [wave-b] 受众画像一键改写 */}
          <section>
            <div className="flex items-center gap-3">
              <SectionLabel>4 · Hooks</SectionLabel>
              {hooksWorking && <OttoNarrationBar steps={["Reading your brand voice…", "Writing hooks…"]} stepMs={1600} className="w-fit" />}
            </div>
            {hooks.length === 0 && !hooksWorking && (
              <div className="mt-3 flex items-center gap-3">
                <Button variant="brand" size="sm" onClick={generateHooks}>Generate hooks · free</Button>
                <p className="text-[13px] text-muted-foreground">Otto writes 5 opening lines for {product.name}. Pick the ones worth testing.</p>
              </div>
            )}
            {hooks.length > 0 && (
              <>
                <div className="mt-3 flex flex-col gap-2">
                  {hooks.map((h, i) => {
                    const on = selectedHooks.includes(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelectedHooks((prev) => (on ? prev.filter((x) => x !== h) : [...prev, h]))}
                        className={cn("flex h-11 items-center gap-3 rounded-[14px] border px-4 text-left transition-colors duration-[120ms]", on ? "border-foreground bg-secondary" : "border-border hover:bg-accent")}
                      >
                        <span className={cn("flex size-5 items-center justify-center rounded-md border", on ? "border-transparent bg-primary text-primary-foreground" : "border-border")}>
                          {on && <Check className="size-3" strokeWidth={2.5} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{h}</span>
                        <span className="font-mono text-[10px] leading-4 text-muted-foreground">hook {i + 1}</span>
                      </button>
                    );
                  })}
                </div>
                {/* [wave-b] 受众画像一键改写(Jasper Audiences):同一素材按客群换措辞 */}
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground">Rewrite for an audience</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {STUDIO_AUDIENCES.map((a) => {
                      const on = audience === a.id;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          aria-pressed={on}
                          title={a.note}
                          onClick={() => setAudience(on ? null : a.id)}
                          className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold transition-colors duration-[120ms]", on ? "border-transparent bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}
                        >
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                  {audience && <p className="mt-1.5 text-xs text-muted-foreground">{STUDIO_AUDIENCES.find((a) => a.id === audience)?.note}</p>}
                </div>
              </>
            )}
          </section>

          {/* ⑤ 变体矩阵(平台 × 尺寸 × 钩子) */}
          <section>
            <SectionLabel>5 · Variant matrix</SectionLabel>
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[560px] overflow-hidden rounded-[18px] border border-border bg-card">
                <div className="grid grid-cols-[120px_repeat(3,1fr)]">
                  <div className="border-b border-border p-3" />
                  {STUDIO_SIZES.map((s) => (
                    <div key={s} className="border-b border-border p-3 text-center font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{s}</div>
                  ))}
                  {STUDIO_PLATFORMS.map((pf) => (
                    <React.Fragment key={pf}>
                      <div className="flex items-center border-b border-border p-3 text-[13px] font-semibold text-foreground last:border-b-0">{pf}</div>
                      {STUDIO_SIZES.map((sz) => {
                        const key = `${pf}|${sz}`;
                        const on = cells.includes(key);
                        const pct = cellPct[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={on}
                            aria-label={`${pf} ${sz}`}
                            onClick={() => toggleCell(key)}
                            className={cn("flex h-14 items-center justify-center border-b border-l border-border transition-colors duration-[120ms] last:border-b-0", on ? "bg-secondary" : "hover:bg-accent")}
                          >
                            {batch !== "idle" && on ? (
                              pct === 100 ? (
                                <Check className="size-4 text-success-soft-foreground" strokeWidth={2.5} />
                              ) : (
                                <span className="flex items-center gap-1.5">
                                  <span className="relative h-[5px] w-12 overflow-hidden rounded-full border border-border bg-background">
                                    <span className="absolute top-0 left-0 h-full rounded-full bg-brand" style={{ width: `${pct ?? 0}%` }} />
                                  </span>
                                  <span className="font-mono text-[10px] leading-4 text-muted-foreground tabular-nums">{pct ?? 0}%</span>
                                </span>
                              )
                            ) : on ? (
                              <Check className="size-4 text-foreground" strokeWidth={2.5} />
                            ) : (
                              <span className="size-4 rounded-md border border-border" />
                            )}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {cells.length} placements × {Math.max(1, selectedHooks.length)} hooks = {variantCount} variants · {STUDIO_CREDITS_PER_VARIANT} credits each
            </p>
          </section>

          {/* [wave-b] 发布前双重体检(Higgsfield Virality + Similarity):发前先知道爆不爆/撞不撞 */}
          {batch === "idle" && (
            <section className="rounded-[18px] border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <ShieldCheck className="size-3.5 text-muted-foreground" strokeWidth={2} />
                    Pre-flight check · free
                  </p>
                  <p className="text-[13px] text-muted-foreground">Otto rates the hook&apos;s viral potential and flags look-alikes before you spend.</p>
                </div>
                {preflight === "none" && <Button variant="secondary" size="sm" onClick={runPreflight}>Run pre-flight</Button>}
                {preflight === "running" && <OttoNarrationBar steps={["Scoring the hook…", "Checking for look-alikes…"]} stepMs={900} className="w-fit" />}
              </div>
              {preflight === "done" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success-soft-foreground">Virality: strong hook</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success-soft-foreground">Similarity: no close matches</span>
                </div>
              )}
            </section>
          )}

          {/* ⑥ 批量总价确认 */}
          <section className="flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-card p-4">
            {batch === "idle" && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{variantCount} variants · {totalCredits} credits total</p>
                  <p className="text-[13px] text-muted-foreground">One confirm covers the whole batch. Nothing is charged until you say go.</p>
                </div>
                <Button variant="brand" disabled={variantCount === 0 || selectedHooks.length === 0} onClick={() => setBatchAsk(true)}>
                  Confirm batch · {totalCredits} credits
                </Button>
              </>
            )}
            {batch === "running" && (
              <>
                <OttoNarrationBar steps={cells.map((_, i) => `Rendering variant set ${i + 1} of ${cells.length}…`)} stepMs={1100} counter className="w-fit" />
                <div className="flex-1" />
                <span className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">{balance.toLocaleString()} credits left</span>
              </>
            )}
            {batch === "done" && (
              <>
                <Badge variant="success">Batch complete</Badge>
                <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">You approved this. It used {totalCredits} credits. The variants are in your Library.</p>
                <Button variant="secondary" size="sm" onClick={() => router.push(`${IMMERSIVE_BASE}/assets/library`)}>Open Library</Button>
              </>
            )}
          </section>

          {/* 完工后:一体化广告 / 资产板 / 编辑工具箱 / 凭证 / 存模板 */}
          {batch === "done" && (
            <DoneExtras
              product={product}
              onEditTool={setEditTool}
              onLicense={() => setLicenseOpen(true)}
              onSaveTpl={() => setSaveTplOpen(true)}
              onSchedule={() => router.push(`${IMMERSIVE_BASE}/schedule/composer`)}
            />
          )}
        </div>
      )}

      {/* 批量花费闸(subject 传 hook → [wave-b] 生成前品牌校验 BrandCheckRow 免费跑一遍) */}
      <SpendConfirmDialog
        open={batchAsk}
        onOpenChange={setBatchAsk}
        title={`Generate ${variantCount} variants?`}
        ask="This will spend real credits."
        subject={selectedHooks[0] ?? product.name}
        impacts={[
          `Cost: ${totalCredits} credits (${variantCount} variants × ${STUDIO_CREDITS_PER_VARIANT}). No charge until you confirm.`,
          `${cells.length} placements across ${STUDIO_PLATFORMS.length} platforms, ${Math.max(1, selectedHooks.length)} hooks each.`,
          "Variants that fail are not charged.",
        ]}
        confirmLabel={`Confirm batch · ${totalCredits} credits`}
        onConfirm={() => {
          setBatchAsk(false);
          runBatch(totalCredits);
        }}
        baseCredits={totalCredits}
        onConfirmTier={(_tier, credits) => {
          setBatchAsk(false);
          runBatch(credits);
        }}
      />

      {/* [wave-b] 品牌语气逆推弹窗 */}
      <SampleLearnDialog
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        title="Learn my voice"
        desc="Paste a few things you've written — a caption, a customer reply. Otto learns your tone; no forms to fill."
        placeholder="Paste 2–3 of your own posts or replies…"
        doneLabel="Voice profile saved. New copy will sound like you."
      />
      {/* [wave-b] 知识库引用防瞎编弹窗 */}
      <SampleLearnDialog
        open={factsOpen}
        onOpenChange={setFactsOpen}
        title="Facts source"
        desc="Paste your price list or specs. Copy that mentions prices must quote these — Otto won't invent numbers."
        placeholder="Merdeka box RM68 · croffle RM12 · office bundle RM120…"
        doneLabel="Facts locked. Otto quotes these instead of guessing."
      />
      {/* [wave-b] 交付授权/使用声明凭证 */}
      <Dialog open={licenseOpen} onOpenChange={setLicenseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usage certificate</DialogTitle>
            <DialogDescription>A one-page PDF stating this is AI-generated and how it can be used — handy when you deliver to a client.</DialogDescription>
          </DialogHeader>
          <div className="rounded-[14px] border border-border bg-card p-4 text-[13px] text-foreground">
            <p className="font-semibold">Roti Bulan Bakery — {product.name}</p>
            <p className="mt-1 text-muted-foreground">Generated with FIKIRTIVE · commercial use granted to the account owner · {new Date().getFullYear()}.</p>
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setLicenseOpen(false)}>Close</Button>
            <Button size="sm" onClick={() => setLicenseOpen(false)}>Download PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* [wave-b] 用户自建 + 可分享创作模板 */}
      <Dialog open={saveTplOpen} onOpenChange={setSaveTplOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as my template</DialogTitle>
            <DialogDescription>Keep this exact setup (mode, style, hooks) to reuse — or share it with a partner shop.</DialogDescription>
          </DialogHeader>
          <input
            defaultValue={`${mode.name} · ${STUDIO_STYLES.find((s) => s.id === styleId)?.name}`}
            aria-label="Template name"
            className="h-11 rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          <div className="flex items-center gap-2 rounded-[10px] border border-border bg-secondary/60 px-3 py-2 text-[13px] text-muted-foreground">
            <Link2 className="size-3.5 shrink-0" strokeWidth={2} />
            fikirtive.app/t/roti-bulan-merdeka
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setSaveTplOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => setSaveTplOpen(false)}>Save template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* [wave-b] 编辑工具箱弹窗(局部内补/扩图/重打光/放大/去背景) */}
      <Dialog open={editTool !== null} onOpenChange={(v) => !v && setEditTool(null)}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{STUDIO_EDIT_TOOLS.find((t) => t.id === editTool)?.label}</DialogTitle>
            <DialogDescription>{STUDIO_EDIT_TOOLS.find((t) => t.id === editTool)?.note} — edits one spot, cheaper than regenerating the whole image.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditTool(null)}>Apply edit</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── 完工后附加动作:一体化广告版式 / 资产板 / 编辑工具箱 / 凭证 / 存模板 ── */
function DoneExtras({
  product,
  onEditTool,
  onLicense,
  onSaveTpl,
  onSchedule,
}: {
  product: (typeof NS_PRODUCTS)[number];
  onEditTool: (id: string) => void;
  onLicense: () => void;
  onSaveTpl: () => void;
  onSchedule: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* [wave-b] 整版广告一体化产出(Adobe Create Canvas):图+标题+CTA+logo 排版成品 */}
      <section className="overflow-hidden rounded-[18px] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Ready-to-run ad</p>
          <p className="text-xs text-muted-foreground">Image, headline, CTA and logo composed — not just a bare picture.</p>
        </div>
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={product.image} alt="" aria-hidden className="aspect-[4/5] w-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-[rgba(10,10,12,0.72)] to-transparent p-4 pt-10">
            <span className="text-base font-bold text-primary-foreground">The box that sells out every Merdeka</span>
            <span className="flex items-center gap-2">
              <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-foreground">Pre-order now</span>
              <span className="ml-auto text-[11px] font-semibold text-primary-foreground/80">Roti Bulan Bakery</span>
            </span>
          </span>
        </div>
        {/* [wave-b] 编辑工具箱:局部修图不重生成整张 */}
        <div className="flex flex-wrap gap-1.5 border-t border-border p-3">
          {STUDIO_EDIT_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onEditTool(t.id)}
              className="flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Wand2 className="size-3" strokeWidth={2} />
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* [wave-b] 项目资产板(Artlist Artboards):素材聚一块 + 缺什么提示 + 免账号分享 */}
      <section className="flex flex-col overflow-hidden rounded-[18px] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Asset board</p>
          <p className="text-xs text-muted-foreground">Everything for this push, in one place.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 p-3">
          {[0, 2, 4, 20, 5, 24].map((i, k) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={k} src={nsImage(k % 2 === 0 ? "campaign" : "bakery", i)} alt="" aria-hidden className="aspect-square w-full rounded-[10px] object-cover" />
          ))}
        </div>
        <div className="mx-3 mb-3 rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-medium text-warning-soft-foreground">
          Otto suggests: still missing a vertical 9:16 story frame.
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-[10px] border border-border bg-secondary/60 px-3 py-2 text-[13px] text-muted-foreground">
            <Link2 className="size-3.5 shrink-0" strokeWidth={2} />
            fikirtive.app/b/merdeka-week
          </div>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={onSchedule}>Schedule these</Button>
        </div>
      </section>

      {/* 交付凭证 + 存模板 */}
      <section className="flex flex-wrap items-center gap-2 rounded-[18px] border border-border bg-card p-4 lg:col-span-2">
        <Button variant="secondary" size="sm" onClick={onSaveTpl}>Save as my template</Button>
        <Button variant="secondary" size="sm" onClick={onLicense}>Usage certificate (PDF)</Button>
      </section>
    </div>
  );
}

/* ── [wave-b] 表格式批量生产(行=商品,列=任务) ── */
function BulkGrid() {
  const router = useRouter();
  const [rows, setRows] = React.useState<string[]>(NS_PRODUCTS.slice(0, 4).map((p) => p.id));
  const [tasks, setTasks] = React.useState<Record<string, boolean>>({ "bt-desc": true, "bt-image": true, "bt-translate": false, "bt-caption": false });
  const [ask, setAsk] = React.useState(false);
  const [done, setDone] = React.useState(false);
  useStore();

  const activeTasks = STUDIO_BULK_TASKS.filter((t) => tasks[t.id]);
  // 只有图片任务耗 credits(文本任务免费),确定性算价。
  const imageJobs = tasks["bt-image"] ? rows.length : 0;
  const total = imageJobs * STUDIO_CREDITS_PER_VARIANT;

  const toggleRow = (id: string) => setRows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const run = (credits: number) => {
    if (credits > 0) {
      spendCredits(credits, `Bulk grid · ${rows.length} products`, "Image");
      studioLogGen(`Ran the bulk grid over ${rows.length} products (${activeTasks.length} tasks each).`, "Factory");
    }
    setDone(true);
  };

  return (
    <div className="mt-6">
      <p className="text-[13px] text-muted-foreground">Rows are products, columns are jobs. Run a batch across your whole menu at once — no repeating yourself to Otto.</p>
      {/* 任务列开关 */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {STUDIO_BULK_TASKS.map((t) => {
          const on = tasks[t.id];
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTasks((prev) => ({ ...prev, [t.id]: !prev[t.id] }))}
              className={cn("h-8 rounded-full border px-3 text-xs font-semibold transition-colors duration-[120ms]", on ? "border-transparent bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[560px] overflow-hidden rounded-[18px] border border-border bg-card">
          <div className="grid" style={{ gridTemplateColumns: `220px repeat(${Math.max(1, activeTasks.length)}, 1fr)` }}>
            <div className="border-b border-border p-3 text-xs font-semibold text-muted-foreground">Product</div>
            {(activeTasks.length ? activeTasks : [{ id: "none", label: "Pick a task" }]).map((t) => (
              <div key={t.id} className="border-b border-l border-border p-3 text-center text-xs font-semibold text-muted-foreground">{t.label}</div>
            ))}
            {NS_PRODUCTS.map((p) => {
              const on = rows.includes(p.id);
              return (
                <React.Fragment key={p.id}>
                  <button type="button" aria-pressed={on} onClick={() => toggleRow(p.id)} className={cn("flex items-center gap-2 border-b border-border p-2.5 text-left transition-colors last:border-b-0", on ? "" : "opacity-45")}>
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-transparent bg-primary text-primary-foreground" : "border-border")}>
                      {on && <Check className="size-3" strokeWidth={2.5} />}
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image} alt="" aria-hidden className="size-8 shrink-0 rounded-[8px] object-cover" />
                    <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{p.name}</span>
                  </button>
                  {(activeTasks.length ? activeTasks : [{ id: "none" }]).map((t) => (
                    <div key={t.id} className="flex items-center justify-center border-b border-l border-border last:border-b-0">
                      {on && activeTasks.length > 0 ? (
                        done ? <Check className="size-4 text-success-soft-foreground" strokeWidth={2.5} /> : <span className="size-2 rounded-full bg-muted-foreground/40" />
                      ) : null}
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-card p-4">
        {!done ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{rows.length} products × {activeTasks.length} tasks</p>
              <p className="text-[13px] text-muted-foreground">{total > 0 ? `${total} credits (images only; text jobs are free).` : "Text-only jobs are free."} Nothing charged until you confirm.</p>
            </div>
            <Button variant="brand" disabled={rows.length === 0 || activeTasks.length === 0} onClick={() => (total > 0 ? setAsk(true) : run(0))}>
              {total > 0 ? `Run bulk · ${total} credits` : "Run bulk · free"}
            </Button>
          </>
        ) : (
          <>
            <Badge variant="success">Bulk complete</Badge>
            <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{rows.length} products done. Results are in your Library.</p>
            <Button variant="secondary" size="sm" onClick={() => router.push(`${IMMERSIVE_BASE}/assets/library`)}>Open Library</Button>
          </>
        )}
      </div>

      <SpendConfirmDialog
        open={ask}
        onOpenChange={setAsk}
        title={`Run the grid over ${rows.length} products?`}
        ask="This will spend real credits."
        impacts={[
          `Cost: ${total} credits (${imageJobs} image jobs × ${STUDIO_CREDITS_PER_VARIANT}). Text jobs are free.`,
          `${activeTasks.length} jobs per product across your selection.`,
          "Jobs that fail are not charged.",
        ]}
        confirmLabel={`Confirm · ${total} credits`}
        onConfirm={() => {
          setAsk(false);
          run(total);
        }}
        baseCredits={total}
        onConfirmTier={(_tier, credits) => {
          setAsk(false);
          run(credits);
        }}
      />
    </div>
  );
}

/* ── [wave-b] 样本学习通用弹窗(品牌语气逆推 #8 / 知识库防瞎编 #9 共用) ── */
function SampleLearnDialog({
  open,
  onOpenChange,
  title,
  desc,
  placeholder,
  doneLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  desc: string;
  placeholder: string;
  doneLabel: string;
}) {
  const [text, setText] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setText("");
      setSaved(false);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        {saved ? (
          <div className="flex items-center gap-2 rounded-[14px] bg-success-soft p-4 text-[13px] font-medium text-success-soft-foreground">
            <Check className="size-4 shrink-0" strokeWidth={2} />
            {doneLabel}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={placeholder}
            className="w-full resize-none rounded-[14px] border border-input bg-card px-3.5 py-3 text-base leading-6 text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
        )}
        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>{saved ? "Close" : "Cancel"}</Button>
          {!saved && <Button size="sm" onClick={() => setSaved(true)} disabled={text.trim().length === 0}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
