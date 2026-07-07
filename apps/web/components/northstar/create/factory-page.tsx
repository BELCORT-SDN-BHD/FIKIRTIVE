"use client";

/**
 * 工厂出片间 — harmony-03 Wave 1-2;判决 7-2(Hook 生成器)/7-3(批量变体矩阵 +
 * 批量总价确认)/7-7;C-01(升级票可见)。
 * 流水线:选产品 → 选模式(Wave 2 口播 = 可见但锁票)→ 选风格 → Hook → 变体矩阵 → 批量确认。
 */

import * as React from "react";
import { Check, Factory, Lock, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MockNote, OttoNarrationBar, PageHeader } from "../_shared";
import { NS_BRAND, NS_PRODUCTS } from "../_mock";
import {
  NS_FACTORY_CREDITS_PER_VARIANT,
  NS_FACTORY_HOOKS,
  NS_FACTORY_MODES,
  NS_FACTORY_PLATFORMS,
  NS_FACTORY_SIZES,
  NS_FACTORY_STYLES,
} from "./_fixtures";
import {
  DemoStateBar,
  ErrorPanel,
  LAND_STYLE,
  SectionLabel,
  Skeleton,
  SpendConfirmDialog,
  useCreateKeyframes,
  type DemoState,
} from "./_create-ui";

type CellKey = string; // `${platform}|${size}`
type BatchState = "idle" | "running" | "done";

export function FactoryPage() {
  useCreateKeyframes();
  const [productId, setProductId] = React.useState(NS_PRODUCTS[5].id);
  const [modeId, setModeId] = React.useState<string>(NS_FACTORY_MODES[0].id);
  const [styleId, setStyleId] = React.useState<string>(NS_FACTORY_STYLES[0].id);
  const [hooks, setHooks] = React.useState<string[]>([]);
  const [hooksWorking, setHooksWorking] = React.useState(false);
  const [selectedHooks, setSelectedHooks] = React.useState<string[]>([]);
  const [cells, setCells] = React.useState<CellKey[]>(["Instagram|4:5", "Instagram|9:16", "TikTok|9:16"]);
  const [batchAsk, setBatchAsk] = React.useState(false);
  const [batch, setBatch] = React.useState<BatchState>("idle");
  const [cellPct, setCellPct] = React.useState<Record<string, number>>({});
  const [balance, setBalance] = React.useState<number>(NS_BRAND.creditBalance);
  const [demo, setDemo] = React.useState<DemoState>("live");
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const product = NS_PRODUCTS.find((p) => p.id === productId) ?? NS_PRODUCTS[0];
  const variantCount = cells.length * Math.max(1, selectedHooks.length);
  const totalCredits = variantCount * NS_FACTORY_CREDITS_PER_VARIANT;

  const generateHooks = () => {
    setHooksWorking(true);
    setHooks([]);
    const t = window.setTimeout(() => {
      setHooks([...NS_FACTORY_HOOKS]);
      setSelectedHooks([NS_FACTORY_HOOKS[0]]);
      setHooksWorking(false);
    }, 3800);
    timers.current.push(t);
  };

  const runBatch = () => {
    setBalance((b) => b - totalCredits);
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
              window.setTimeout(() => setBatch("done"), 500);
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
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Factory"
        subtitle="From product to ready-to-run ads, one batch at a time."
        meta={[`${balance.toLocaleString()} credits`]}
        actions={<DemoStateBar state={demo} onChange={setDemo} />}
      />

      {demo === "loading" && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shimmer={i < 3} className="h-48 w-full rounded-[18px]" />
          ))}
        </div>
      )}
      {demo === "empty" && (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-[14px] bg-secondary">
            <Factory className="size-5 text-muted-foreground" strokeWidth={2} />
          </span>
          <p className="text-lg font-semibold text-foreground">No products yet</p>
          <p className="max-w-[420px] text-sm text-muted-foreground">
            Add a product in Brand memory and the factory can start cutting ads from it.
          </p>
          <Button size="sm" onClick={() => setDemo("live")}>Add a product</Button>
        </div>
      )}
      {demo === "error" && (
        <ErrorPanel className="mt-6" what="Couldn't load the factory." money="You weren't charged." onRetry={() => setDemo("live")} />
      )}

      {demo === "live" && (
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

          {/* ② 模式(Wave 1 可选;Wave 2 口播锁票可见 — C-01 纪律) */}
          <section>
            <SectionLabel>2 · Mode</SectionLabel>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {NS_FACTORY_MODES.map((m) => {
                const locked = m.wave === 2;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={locked}
                    aria-pressed={modeId === m.id}
                    onClick={() => setModeId(m.id)}
                    className={cn(
                      "relative flex flex-col gap-1 rounded-[14px] border p-4 text-left transition-colors duration-[120ms]",
                      locked
                        ? "border-dashed border-border opacity-70"
                        : modeId === m.id
                          ? "border-foreground bg-secondary"
                          : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      {locked && <Lock className="size-3.5 text-muted-foreground" strokeWidth={2} />}
                      {m.name}
                    </span>
                    <span className="text-xs leading-4 text-muted-foreground">{m.desc}</span>
                    {locked && (
                      <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] leading-4 font-medium tracking-[0.06em] text-muted-foreground">
                        <Ticket className="size-3" strokeWidth={2} />
                        Wave 2 · upgrade ticket
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ③ 风格 */}
          <section>
            <SectionLabel>3 · Style</SectionLabel>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {NS_FACTORY_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={styleId === s.id}
                  onClick={() => setStyleId(s.id)}
                  className={cn(
                    "overflow-hidden rounded-[14px] border text-left transition-colors duration-[120ms]",
                    styleId === s.id ? "border-foreground" : "border-border hover:bg-accent",
                  )}
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
          </section>

          {/* ④ Hook 生成器(判决 7-2) */}
          <section>
            <div className="flex items-center gap-3">
              <SectionLabel>4 · Hooks</SectionLabel>
              {hooksWorking && (
                <OttoNarrationBar steps={["Reading your brand voice…", "Writing hooks…"]} stepMs={1700} className="w-fit" />
              )}
            </div>
            {hooks.length === 0 && !hooksWorking && (
              <div className="mt-3 flex items-center gap-3">
                <Button variant="brand" size="sm" onClick={generateHooks}>
                  Generate hooks · free
                </Button>
                <p className="text-[13px] text-muted-foreground">
                  Otto writes 5 opening lines for {product.name}. Pick the ones worth testing.
                </p>
              </div>
            )}
            {hooks.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {hooks.map((h, i) => {
                  const on = selectedHooks.includes(h);
                  return (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSelectedHooks((prev) => (on ? prev.filter((x) => x !== h) : [...prev, h]))
                      }
                      className={cn(
                        "flex h-11 items-center gap-3 rounded-[14px] border px-4 text-left transition-colors duration-[120ms]",
                        on ? "border-foreground bg-secondary" : "border-border hover:bg-accent",
                      )}
                      style={LAND_STYLE}
                    >
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-md border",
                          on ? "border-transparent bg-primary text-primary-foreground" : "border-border",
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={2.5} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{h}</span>
                      <span className="font-mono text-[10px] leading-4 text-muted-foreground">hook {i + 1}</span>
                    </button>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  {selectedHooks.length} of {hooks.length} hooks selected · Otto wrote these from your brand memory
                </p>
              </div>
            )}
          </section>

          {/* ⑤ 变体矩阵(判决 7-3:平台 × 尺寸 × 钩子) */}
          <section>
            <SectionLabel>5 · Variant matrix</SectionLabel>
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[560px] overflow-hidden rounded-[18px] border border-border bg-card">
                <div className="grid grid-cols-[120px_repeat(3,1fr)]">
                  <div className="border-b border-border p-3" />
                  {NS_FACTORY_SIZES.map((s) => (
                    <div key={s} className="border-b border-border p-3 text-center font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      {s}
                    </div>
                  ))}
                  {NS_FACTORY_PLATFORMS.map((pf) => (
                    <React.Fragment key={pf}>
                      <div className="flex items-center border-b border-border p-3 text-[13px] font-semibold text-foreground last:border-b-0">
                        {pf}
                      </div>
                      {NS_FACTORY_SIZES.map((sz) => {
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
                            className={cn(
                              "flex h-14 items-center justify-center border-b border-l border-border transition-colors duration-[120ms] last:border-b-0",
                              on ? "bg-secondary" : "hover:bg-accent",
                            )}
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
              {cells.length} placements × {Math.max(1, selectedHooks.length)} hooks = {variantCount} variants ·{" "}
              {NS_FACTORY_CREDITS_PER_VARIANT} credits each
            </p>
          </section>

          {/* ⑥ 批量总价确认(判决 7-3/7-7) */}
          <section className="flex items-center gap-3 rounded-[18px] border border-border bg-card p-4">
            {batch === "idle" && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {variantCount} variants · {totalCredits} credits total
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    One confirm covers the whole batch. Nothing is charged until you say go.
                  </p>
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
                <span className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">
                  {balance.toLocaleString()} credits left
                </span>
              </>
            )}
            {batch === "done" && (
              <>
                <Badge variant="success">Batch complete</Badge>
                <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                  You approved this. It used {totalCredits} credits. The variants are in your Library.
                </p>
                <Button variant="secondary" size="sm">Open Library</Button>
              </>
            )}
          </section>
        </div>
      )}

      <SpendConfirmDialog
        open={batchAsk}
        onOpenChange={setBatchAsk}
        title={`Generate ${variantCount} variants?`}
        ask="This will spend real credits."
        impacts={[
          `Cost: ${totalCredits} credits (${variantCount} variants × ${NS_FACTORY_CREDITS_PER_VARIANT}). No charge until you confirm.`,
          `${cells.length} placements across ${NS_FACTORY_PLATFORMS.length} platforms, ${Math.max(1, selectedHooks.length)} hooks each.`,
          "Variants that fail are not charged.",
        ]}
        confirmLabel={`Confirm batch · ${totalCredits} credits`}
        onConfirm={() => {
          setBatchAsk(false);
          runBatch();
        }}
      />

      <MockNote path="/northstar/create/factory" />
    </div>
  );
}
