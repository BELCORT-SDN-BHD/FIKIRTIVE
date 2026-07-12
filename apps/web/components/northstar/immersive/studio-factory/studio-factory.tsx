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
  Clapperboard,
  FileText,
  Grid3x3,
  Layers,
  Link2,
  Lock,
  Mic,
  RotateCcw,
  ShieldCheck,
  Ticket,
  TriangleAlert,
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
import { NS_BRAND, NS_PRODUCTS, nsImage, type NsProduct } from "@/components/northstar/_mock";
import { SectionLabel, SpendConfirmDialog, useCreateKeyframes } from "@/components/northstar/create/_create-ui";
import { IMMERSIVE_BASE, useSweep } from "../_kit";
import { balance as getBalance, ottoWorking as setOttoWorking, refundCredits, spendCredits, studioLogGen, useStore } from "../_store";
import { OttoAssist } from "../otto-assist";
import {
  HOOK_COLDSTART_NOTE,
  STUDIO_AUDIENCES,
  STUDIO_BULK_TASKS,
  STUDIO_CREDITS_PER_VARIANT,
  STUDIO_EDIT_TOOLS,
  STUDIO_MODES,
  STUDIO_PLATFORMS,
  STUDIO_SIZES,
  STUDIO_STYLES,
  studioHooks,
  type StudioHook,
} from "./data";

type CellKey = string; // `${platform}|${size}`
type BatchState = "idle" | "running" | "done";
type Tool = "batch" | "bulk";

/** 分享链接 slug:小写、非字母数字→连字符(确定性,无 locale API 副作用)。 */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "batch";
}

/** #2 缺口按实际交付的尺寸算,不写死「缺 9:16」。每个尺寸一句真话。 */
const SIZE_GAP: Record<string, string> = {
  "9:16": "a vertical 9:16 story frame — the format that runs strongest on TikTok MY this month",
  "1:1": "a square 1:1 feed post to round out the set",
  "4:5": "a portrait 4:5 feed post to round out the set",
};

export function StudioFactory() {
  useCreateKeyframes();
  useStore();
  const router = useRouter();
  const hookSweep = useSweep();
  const [tool, setTool] = React.useState<Tool>("batch");

  // 主流水线状态
  const [productId, setProductId] = React.useState(NS_PRODUCTS[5].id);
  const [modeId, setModeId] = React.useState(STUDIO_MODES[0].id);
  const [lockedShots, setLockedShots] = React.useState<number[]>([]); // [wave-b] money-shot 锁定的产品照片
  const [styleId, setStyleId] = React.useState(STUDIO_STYLES[0].id);
  const [hooks, setHooks] = React.useState<StudioHook[]>([]);
  const [hooksWorking, setHooksWorking] = React.useState(false);
  const [selectedHookIds, setSelectedHookIds] = React.useState<string[]>([]);
  const [audience, setAudience] = React.useState<string | null>(null); // [wave-b] 受众改写
  const [cells, setCells] = React.useState<CellKey[]>(["Instagram|4:5", "Instagram|9:16", "TikTok|9:16"]);
  const [batchAsk, setBatchAsk] = React.useState(false);
  const [batch, setBatch] = React.useState<BatchState>("idle");
  const [cellPct, setCellPct] = React.useState<Record<string, number>>({});
  const [failedCells, setFailedCells] = React.useState<CellKey[]>([]); // #57 单格失败,已退款(兑现「失败不收费」)
  const failedOnceRef = React.useRef(false); // 只在首批演示一次失败,之后全成功(别让 demo 显得常坏)
  const refundedRef = React.useRef<Set<string>>(new Set()); // 每格只退一次(防 StrictMode updater 双跑重复退款)
  // 交付快照:成品广告卡/结账账目冻结成批次那一刻的产品+钩子+CTA(换产品换文案在成品处也成立;
  // 之后再拨钩子/产品都不改已交付的这版)。
  const [delivered, setDelivered] = React.useState<{
    product: NsProduct;
    hook: StudioHook;
    cta: string;
    cellCount: number;
    /** #2 冻结实际交付的placements,成品资产板据此算真缺口(而非写死「缺 9:16」) */
    cells: CellKey[];
    perCellCredits: number;
    totalCredits: number;
  } | null>(null);
  const hooksTimer = React.useRef<number | null>(null); // #4 待触发的 hook 生成 timeout(换产品要取消它,别用旧产品文案回填)
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
  const hookSet = React.useMemo(() => studioHooks(product), [product]);
  const selectedHooks = hooks.filter((h) => selectedHookIds.includes(h.id));
  const variantCount = cells.length * Math.max(1, selectedHooks.length);
  const totalCredits = variantCount * STUDIO_CREDITS_PER_VARIANT;
  // #5 Money-shot 承诺「锁产品才保真」:锁不满 4 张就不许跑批,否则交付的成品并没按承诺锁定包装/logo。
  const MIN_LOCKED_SHOTS = 4;
  const productLockUnmet = mode.productLock === true && lockedShots.length < MIN_LOCKED_SHOTS;

  // 换产品 = 换 hook(hook = f(产品);不留上一个产品的文案冒充这一个)。在选产品处清,
  // 不用 effect(避免 render 内同步 setState)。
  const pickProduct = (id: string) => {
    if (id === productId) return;
    // #4 换产品必须取消上一个产品还在飞的 hook 生成:否则过期 timeout 会把旧产品的钩子回填,
    // 而抬头已跟新产品走 —— 正是本区要杀的「产品盲」错配。同时把「挖角度」状态一并落下。
    if (hooksTimer.current !== null) {
      window.clearTimeout(hooksTimer.current);
      hooksTimer.current = null;
    }
    setHooksWorking(false);
    setProductId(id);
    setHooks([]);
    setSelectedHookIds([]);
    setPreflight("none");
  };

  const applyHooks = (set: ReturnType<typeof studioHooks>) => {
    setHooks(set.hooks);
    setSelectedHookIds([set.hooks[0].id]);
  };

  const generateHooks = () => {
    setHooksWorking(true);
    setHooks([]);
    if (hooksTimer.current !== null) window.clearTimeout(hooksTimer.current);
    const t = window.setTimeout(() => {
      applyHooks(hookSet);
      setHooksWorking(false);
      hooksTimer.current = null;
    }, 3400);
    hooksTimer.current = t;
    timers.current.push(t);
  };

  const runPreflight = () => {
    setPreflight("running");
    const t = window.setTimeout(() => setPreflight("done"), 1800);
    timers.current.push(t);
  };

  // 一格的价 = 该格跑的变体数(= 选中钩子数)× 单价。退款/结账都按这个锚,和分镜 #57 同口径。
  const perCellCredits = Math.max(1, selectedHooks.length) * STUDIO_CREDITS_PER_VARIANT;

  const runBatch = (credits: number) => {
    spendCredits(credits, `${variantCount} variants · ${product.name}`, "Image");
    setOttoWorking(true, "Rendering variants…");
    studioLogGen(`Cutting ${variantCount} ad variants of ${product.name}. Failed ones aren't charged.`, "Factory");
    // #1 交付快照:成品广告卡读这一版的产品+首个选中钩子+CTA,冻结账目。
    const hook = selectedHooks[0] ?? null;
    setDelivered(
      hook ? { product, hook, cta: hookSet.cta, cellCount: cells.length, cells: [...cells], perCellCredits, totalCredits } : null,
    );
    setBatch("running");
    setFailedCells([]);
    refundedRef.current = new Set();
    // #57 兑现「失败不收费」:首批让一格当面失败一次 —— 退回那格的 credits(可核对的 ledger 行)+
    // 可见失败态 + 可重试。之后的批次/重试全成功,不把 demo 弄成常坏。
    const failKey = !failedOnceRef.current ? (cells.length > 1 ? cells[1] : cells[0]) : null;
    cells.forEach((key, i) => {
      const willFail = key === failKey;
      const t = window.setTimeout(() => {
        const iv = window.setInterval(() => {
          setCellPct((prev) => {
            const cur = prev[key] ?? 0;
            if (cur >= 100) {
              window.clearInterval(iv);
              return prev;
            }
            // 失败格:卡到 ~54% 落失败,退这格的钱,不再前进。
            if (willFail && cur >= 54) {
              window.clearInterval(iv);
              failedOnceRef.current = true;
              if (!refundedRef.current.has(key)) {
                refundedRef.current.add(key);
                refundCredits(perCellCredits, `${key} placement didn't render`);
              }
              setFailedCells((f) => (f.includes(key) ? f : [...f, key]));
              if (i === cells.length - 1) {
                window.setTimeout(() => {
                  setBatch("done");
                  setOttoWorking(false);
                }, 500);
              }
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

  // #57 重试单格:重新扣这格的钱(之前失败已退,重试即重新付),渲到成功。用交付快照冻结的
  // 单格价,和当初退的数对得上(哪怕交付后又拨过钩子选择)。
  const retryCell = (key: CellKey) => {
    spendCredits(delivered?.perCellCredits ?? perCellCredits, `Retry · ${key} placement`, "Image");
    setFailedCells((f) => f.filter((k) => k !== key));
    setCellPct((prev) => ({ ...prev, [key]: 0 }));
    setOttoWorking(true, "Re-rendering one placement…");
    const iv = window.setInterval(() => {
      setCellPct((prev) => {
        const cur = prev[key] ?? 0;
        if (cur >= 100) {
          window.clearInterval(iv);
          return prev;
        }
        const next = { ...prev, [key]: Math.min(100, cur + 9) };
        if (next[key] === 100) window.setTimeout(() => setOttoWorking(false), 400);
        return next;
      });
    }, 200);
    timers.current.push(iv);
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
                  onClick={() => pickProduct(p.id)}
                  className={cn(
                    "ns-pressable w-40 shrink-0 overflow-hidden rounded-[14px] border text-left",
                    productId === p.id ? "border-[var(--human)]" : "border-border",
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
                      "relative flex flex-col gap-1 rounded-[14px] border p-4 text-left",
                      locked
                        ? "border-dashed border-border opacity-70 transition-colors duration-[120ms]"
                        : cn("ns-pressable", modeId === m.id ? "border-[var(--human)] bg-secondary" : "border-border"),
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
                  className={cn(
                    "ns-pressable overflow-hidden rounded-[14px] border text-left",
                    styleId === s.id ? "border-[var(--human)]" : "border-border",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumb} alt={s.name} className="aspect-[8/5] w-full object-cover" />
                  <div className="p-2.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{s.name}</span>
                      {styleId === s.id && <Check className="size-4 shrink-0 text-[var(--human)]" strokeWidth={2.2} />}
                    </span>
                    {/* 去盲选:每卡一行「适合什么」 */}
                    <span className="mt-1 block text-xs leading-4 text-muted-foreground">{s.goodFor}</span>
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

          {/* ④ Hook 生成器(角度库法)+ [wave-b] 受众画像一键改写 */}
          <section style={hookSweep.style}>
            <div className="flex flex-wrap items-center gap-3">
              <SectionLabel>4 · Hooks</SectionLabel>
              {hooksWorking && <OttoNarrationBar steps={[`Mining angles for ${product.name}…`, "Writing hooks per angle…"]} stepMs={1600} className="w-fit" />}
              <div className="flex-1" />
              {/* §O7「Otto 帮我」—— 每个动脑面一颗;Apply 把角度回填 Hooks 列表 */}
              <OttoAssist
                zone="Studio"
                entityId={product.id}
                entityLabel={product.name}
                formState={{ style: styleId, mode: modeId, selected: selectedHookIds }}
                intents={[
                  {
                    id: "st-gen-hooks",
                    label: `Write hooks for ${product.name}`,
                    prompt: `Write ad hooks for ${product.name} (RM${product.priceMyr}).`,
                    reply: `${hookSet.frame}. Each hook is a different audience × objection × scene, so you're testing angles — not reworded versions of one line. Apply drops them into your Hooks list.`,
                    apply: { summary: `Fill ${hookSet.hooks.length} angle-based hooks`, patch: { kind: "fill-hooks" } },
                  },
                  {
                    id: "st-pair",
                    label: "Which two should I test?",
                    prompt: "Which two hooks should I run against each other?",
                    reply: hookSet.pairing,
                  },
                  {
                    id: "st-bm",
                    label: "Adapt these for Bahasa Melayu",
                    prompt: "Rewrite the hooks in Bahasa Melayu.",
                    reply: "I can carry each angle into natural BM once translation is wired — for now the English angles are ready to test. I won't machine-translate blindly and risk a wrong price or claim.",
                  },
                ]}
                onApply={(a) => {
                  if ((a.patch as { kind?: string }).kind === "fill-hooks") {
                    applyHooks(hookSet);
                    hookSweep.fire();
                  }
                }}
              />
            </div>
            {hooks.length === 0 && !hooksWorking && (
              <div className="mt-3 flex items-center gap-3">
                <Button variant="brand" size="sm" onClick={generateHooks}>Generate hooks · free</Button>
                <p className="text-[13px] text-muted-foreground">Otto mines the angles for {product.name} — its price, category and what makes it worth buying. Pick the ones worth testing.</p>
              </div>
            )}
            {hooks.length > 0 && (
              <>
                {/* 角度组合抬头(product-aware,证明不是写死清单) */}
                <p className="mt-3 text-[13px] leading-[18px] font-medium text-foreground">{hookSet.frame}</p>
                <div className="mt-3 flex flex-col gap-2">
                  {hooks.map((h) => {
                    const on = selectedHookIds.includes(h.id);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelectedHookIds((prev) => (on ? prev.filter((x) => x !== h.id) : [...prev, h.id]))}
                        className={cn(
                          "ns-pressable flex items-start gap-3 rounded-[14px] border px-4 py-3 text-left",
                          on ? "border-[var(--human)]" : "border-border",
                        )}
                      >
                        <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border", on ? "border-transparent bg-[var(--human)] text-white" : "border-border")}>
                          {on && <Check className="size-3" strokeWidth={2.5} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] leading-4 font-medium tracking-[0.04em] text-muted-foreground uppercase">
                              {h.angle} · {h.register}
                            </span>
                            {h.power === "Very high" && (
                              <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 font-mono text-[10px] leading-4 font-medium tracking-[0.04em] text-warning-soft-foreground uppercase">
                                Top angle
                              </span>
                            )}
                          </span>
                          <span className="mt-1.5 block text-sm leading-[20px] font-medium text-foreground">{h.line}</span>
                          {/* 为什么推荐(判断层:绑这个产品这个角度的机制,非通用套话) */}
                          <span className="mt-1 block text-xs leading-[16px] text-muted-foreground">Why: {h.why}</span>
                          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] leading-4 font-medium text-muted-foreground">
                            <Clapperboard className="size-3" strokeWidth={2} />
                            {h.format}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* 配对建议 + 冷启动诚实标注 */}
                <p className="mt-2.5 text-[13px] leading-[18px] text-foreground"><span className="font-semibold">Test pair:</span> {hookSet.pairing}</p>
                <p className="mt-1 text-xs leading-[16px] text-muted-foreground">{HOOK_COLDSTART_NOTE}</p>
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
                            {failedCells.includes(key) ? (
                              <TriangleAlert className="size-4 text-warning-soft-foreground" strokeWidth={2} />
                            ) : batch !== "idle" && on ? (
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
                  <p className="text-[13px] text-muted-foreground">Otto rates your top hook&apos;s open and flags a one-angle batch before you spend.</p>
                </div>
                {preflight === "none" && <Button variant="secondary" size="sm" onClick={runPreflight}>Run pre-flight</Button>}
                {preflight === "running" && <OttoNarrationBar steps={[`Scoring the "${selectedHooks[0]?.angle ?? "opening"}" hook…`, "Checking the batch's angle spread…"]} stepMs={900} className="w-fit" />}
              </div>
              {preflight === "done" && (() => {
                const top = selectedHooks[0];
                const strong = top ? top.power !== "Med" : false;
                // #2 相似度不再写死「你最近 20 帖没撞脸」(那是我们没有的历史数据、还永远显 clear)。
                // 改成能真算的锚:这一批跨几个不同角度 —— 一个角度铺满 N 个尺寸就是「一版复用」。
                const distinctAngles = new Set(selectedHooks.map((h) => h.angle)).size;
                const varied = distinctAngles >= 2;
                return (
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", strong ? "bg-success-soft text-success-soft-foreground" : "bg-warning-soft text-warning-soft-foreground")}>
                        {top
                          ? strong
                            ? `Virality: strong — the "${top.angle}" angle opens on the hook, not a logo, so it lands in the first 2s`
                            : `Virality: fair — "${top.angle}" is a softer open; the test pair above hardens it`
                          : "Virality: pick a hook to score"}
                      </span>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", varied ? "bg-success-soft text-success-soft-foreground" : "bg-secondary text-muted-foreground")}>
                        {varied
                          ? `Similarity: varied — ${distinctAngles} angles across ${variantCount} variants, not one line reskinned`
                          : `Similarity: one angle — ${variantCount} variants of a single hook; add a second so you test angles, not sizes`}
                      </span>
                    </div>
                    {/* §五 判断层:标明依据(能算的:本批角度铺开)+ 不确定性 + 承认没接账号历史,不假装精确 */}
                    <p className="mt-2 text-xs leading-4 text-muted-foreground">A structural read on this batch&apos;s angle spread and the top hook&apos;s open — a proxy for freshness before you spend, not a match against your past posts (that needs your account connected).</p>
                  </div>
                );
              })()}
            </section>
          )}

          {/* ⑥ 批量总价确认 */}
          <section className="flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-card p-4">
            {batch === "idle" && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{variantCount} variants · {totalCredits} credits total</p>
                  <p className="text-[13px] text-muted-foreground">
                    {productLockUnmet
                      ? `Lock ${MIN_LOCKED_SHOTS - lockedShots.length} more product photo${MIN_LOCKED_SHOTS - lockedShots.length === 1 ? "" : "s"} up in step 2b first — money-shot mode can't keep your packaging and logo true without them.`
                      : "One confirm covers the whole batch. Nothing is charged until you say go."}
                  </p>
                </div>
                <Button variant="brand" disabled={variantCount === 0 || selectedHooks.length === 0 || productLockUnmet} onClick={() => setBatchAsk(true)}>
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
            {batch === "done" && delivered && failedCells.length > 0 && (
              <>
                <Badge variant="warning">{delivered.cellCount - failedCells.length} of {delivered.cellCount} placements rendered</Badge>
                <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                  You were charged {(delivered.cellCount - failedCells.length) * delivered.perCellCredits} credits — the failed placement was refunded. Retry it, or open what rendered.
                </p>
                <Button variant="secondary" size="sm" onClick={() => failedCells.forEach((key) => retryCell(key))}>
                  <RotateCcw className="size-3.5" strokeWidth={2} />
                  Retry placement · {failedCells.length * (delivered?.perCellCredits ?? perCellCredits)} credits
                </Button>
                <Button variant="secondary" size="sm" onClick={() => router.push(`${IMMERSIVE_BASE}/assets/library`)}>Open Library</Button>
              </>
            )}
            {batch === "done" && failedCells.length === 0 && (
              <>
                <Badge variant="success">Batch complete</Badge>
                <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">You approved this. It used {delivered?.totalCredits ?? totalCredits} credits. The variants are in your Library.</p>
                <Button variant="secondary" size="sm" onClick={() => router.push(`${IMMERSIVE_BASE}/assets/library`)}>Open Library</Button>
              </>
            )}
          </section>

          {/* 完工后:一体化广告 / 资产板 / 编辑工具箱 / 凭证 / 存模板。成品读交付快照(冻结的
              产品 + 首个钩子 + CTA),兑现「换产品换文案」直到真正要发的成品处。 */}
          {batch === "done" && delivered && (
            <DoneExtras
              product={delivered.product}
              headline={delivered.hook.line}
              cta={delivered.cta}
              cells={delivered.cells}
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
        subject={selectedHooks[0]?.line ?? product.name}
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
            <p className="font-semibold">{NS_BRAND.name} — {product.name}</p>
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
  headline,
  cta,
  cells,
  onEditTool,
  onLicense,
  onSaveTpl,
  onSchedule,
}: {
  product: (typeof NS_PRODUCTS)[number];
  /** #1 成品标题 = 这一版真正选中的钩子文案(不再写死 Merdeka 礼盒句) */
  headline: string;
  /** #1 CTA 按产品原型走(礼盒预购 / 蛋糕订期 / 单品即买) */
  cta: string;
  /** #2 实际交付的 placements（`${platform}|${size}`）—— 缺口据此真算,不写死 */
  cells: CellKey[];
  onEditTool: (id: string) => void;
  onLicense: () => void;
  onSaveTpl: () => void;
  onSchedule: () => void;
}) {
  // #2 真缺口:成品覆盖哪些尺寸,就据此报缺(默认两张 9:16 已在,缺的是 1:1),不再假报「缺 9:16」。
  const deliveredSizes = new Set(cells.map((k) => k.split("|")[1]));
  const missing = STUDIO_SIZES.filter((s) => !deliveredSizes.has(s));
  const primaryGap = missing.includes("9:16") ? "9:16" : missing[0];
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
            <span className="text-base font-bold text-primary-foreground">{headline}</span>
            <span className="flex items-center gap-2">
              <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-foreground">{cta}</span>
              <span className="ml-auto text-[11px] font-semibold text-primary-foreground/80">{NS_BRAND.name}</span>
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
        {primaryGap ? (
          <div className="mx-3 mb-3 rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-medium text-warning-soft-foreground">
            Otto suggests: add {SIZE_GAP[primaryGap]}.
          </div>
        ) : (
          <div className="mx-3 mb-3 rounded-[10px] bg-success-soft px-3 py-2 text-xs font-medium text-success-soft-foreground">
            Otto: all three ratios covered — square feed, portrait and 9:16 story. Ready to schedule.
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-[10px] border border-border bg-secondary/60 px-3 py-2 text-[13px] text-muted-foreground">
            <Link2 className="size-3.5 shrink-0" strokeWidth={2} />
            fikirtive.app/b/{slug(product.name)}
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
  // #3 兑现「失败不收费」:bulk grid 也真有失败分支 + 退款(和分镜 / 变体批同口径,不再只承诺)。
  // 图片任务才会失败(文本任务免费、不落 credits);首批演示一格失败一次,之后全成功。
  const [failedRows, setFailedRows] = React.useState<string[]>([]); // 图片任务失败并已退款的产品 id
  const failedOnceRef = React.useRef(false);
  useStore();

  const activeTasks = STUDIO_BULK_TASKS.filter((t) => tasks[t.id]);
  // 只有图片任务耗 credits(文本任务免费),确定性算价。
  const imageJobs = tasks["bt-image"] ? rows.length : 0;
  const total = imageJobs * STUDIO_CREDITS_PER_VARIANT;
  const PER = STUDIO_CREDITS_PER_VARIANT; // 一个产品的图片任务价

  const toggleRow = (id: string) => setRows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const run = (credits: number) => {
    setFailedRows([]);
    if (credits > 0) {
      spendCredits(credits, `Bulk grid · ${rows.length} products`, "Image");
      // #3 首批让一个产品的图片任务当面失败一次 —— 退回它那份 credits(可核对的 ledger 行),
      // 落可见失败态 + 可重试。之后的批次全成功,不把 demo 弄成常坏。
      if (!failedOnceRef.current && imageJobs > 0) {
        failedOnceRef.current = true;
        const failId = rows[1] ?? rows[0];
        const failName = NS_PRODUCTS.find((p) => p.id === failId)?.name ?? "one product";
        refundCredits(PER, `${failName} image job didn't render`);
        setFailedRows([failId]);
        studioLogGen(`Ran the bulk grid over ${rows.length} products (${activeTasks.length} tasks each). One image job failed and wasn't charged — ${PER} credits refunded.`, "Factory");
      } else {
        studioLogGen(`Ran the bulk grid over ${rows.length} products (${activeTasks.length} tasks each).`, "Factory");
      }
    }
    setDone(true);
  };

  // #3 重试单个产品的图片任务:重新扣它那份钱(之前失败已退,重试即重新付),渲到成功。
  const retryRow = (id: string) => {
    const name = NS_PRODUCTS.find((p) => p.id === id)?.name ?? "product";
    spendCredits(PER, `Retry · ${name} image`, "Image");
    setFailedRows((f) => f.filter((x) => x !== id));
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
                  {(activeTasks.length ? activeTasks : [{ id: "none" }]).map((t) => {
                    // #3 只有图片任务会失败;失败格显警告(其余文本任务照常成功)。
                    const failedHere = t.id === "bt-image" && failedRows.includes(p.id);
                    return (
                      <div key={t.id} className="flex items-center justify-center border-b border-l border-border last:border-b-0">
                        {on && activeTasks.length > 0 ? (
                          failedHere ? (
                            <TriangleAlert className="size-4 text-warning-soft-foreground" strokeWidth={2} />
                          ) : done ? (
                            <Check className="size-4 text-success-soft-foreground" strokeWidth={2.5} />
                          ) : (
                            <span className="size-2 rounded-full bg-muted-foreground/40" />
                          )
                        ) : null}
                      </div>
                    );
                  })}
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
        ) : failedRows.length > 0 ? (
          <>
            <Badge variant="warning">{rows.length - failedRows.length} of {rows.length} image jobs rendered</Badge>
            <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
              One image job failed and wasn&apos;t charged — {failedRows.length * PER} credits went back. Text jobs and the rest are in your Library.
            </p>
            <Button variant="secondary" size="sm" onClick={() => failedRows.forEach((id) => retryRow(id))}>
              <RotateCcw className="size-3.5" strokeWidth={2} />
              Retry image · {failedRows.length * PER} credits
            </Button>
            <Button variant="secondary" size="sm" onClick={() => router.push(`${IMMERSIVE_BASE}/assets/library`)}>Open Library</Button>
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
