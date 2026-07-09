/* @nsPage district="资产区" page="brand-memory" status="draft"
   sources="区划图·资产区(#103/#113/#124);O-04 判决" approvedAt="" pr="" */
"use client";

/**
 * Brand memory(品牌记忆)—「懂你的店」的 6-tab 知识库(P0 · live·revamp)
 * 清单要素:6 tab(§N4 tabs 参考型即本页)、living collections(事实行可增改删)、
 * 产品档案与分类、产品链接一键建档(#124:贴 URL → Otto 草拟档案落地 sweep)、
 * 自养入口(O-04:Research my site → 叙述条 → 新事实落地 + tab coral dot ≤4s 自清)。
 * Otto 出场(§O3):research affordance + updated dots;moods idle·helpful·thinking·success。
 */

import * as React from "react";
import { toast } from "sonner";
import { BookOpen, Link2, Pencil, Plus, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DemoStateBar,
  ErrorPanel,
  OttoMark,
  SegChips,
  Skeleton,
  SweepIn,
  ZoneTabs,
  type DemoState,
} from "@/components/northstar/assets/_zone";
import {
  INGESTED_PRODUCT,
  INGEST_STEPS,
  MEMORY_FACTS,
  MEMORY_PRODUCT_CATEGORIES,
  MEMORY_PRODUCTS,
  MEMORY_SEGMENTS,
  MEMORY_TABS,
  RESEARCHED_FACTS,
  RESEARCH_STEPS,
  type MemoryFact,
  type MemoryTabKey,
} from "@/components/northstar/assets/_data";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import { brandPreferences, useStore } from "@/components/northstar/immersive/_store";
import type { NsProduct } from "@/components/northstar/_mock";
import { useImmersive } from "@/components/northstar/immersive/_context";
import { askOttoInline } from "@/components/northstar/immersive/_store";

const FACT_TABS: MemoryTabKey[] = ["about", "look", "offers", "rules"];

export default function Page() {
  const immersive = useImmersive();
  useStore();
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [tab, setTab] = React.useState<MemoryTabKey>("about");
  // 连接器 O-04:asset-viewer / library 的赞踩回灌到这里(带来源)。
  const learned = brandPreferences();
  const [facts, setFacts] = React.useState<MemoryFact[]>(MEMORY_FACTS);
  const [products, setProducts] = React.useState<NsProduct[]>(MEMORY_PRODUCTS);
  const [productCat, setProductCat] = React.useState("All");

  /** 一屏一条叙述(§8c):research 与 ingest 互斥 */
  const [ottoJob, setOttoJob] = React.useState<"research" | "ingest" | null>(null);
  const [ingestUrl, setIngestUrl] = React.useState("");
  const [landed, setLanded] = React.useState<Record<string, "sweep" | "land">>({});
  /** tab 上的 6px coral dot(≤4s 自清,§N4) */
  const [aboutDot, setAboutDot] = React.useState(false);

  const dotTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (dotTimer.current) window.clearTimeout(dotTimer.current);
  }, []);

  const finishResearch = () => {
    setFacts((prev) => [...RESEARCHED_FACTS.filter((f) => !prev.some((p) => p.id === f.id)), ...prev]);
    setLanded((prev) => ({
      ...prev,
      ...Object.fromEntries(RESEARCHED_FACTS.map((f) => [f.id, "sweep" as const])),
    }));
    setOttoJob(null);
    if (tab !== "about") {
      setAboutDot(true);
      dotTimer.current = window.setTimeout(() => setAboutDot(false), 4000);
    }
    // 就地 Otto 统一(O-12):这轮研究进共享 dock/otto-chat 的同一根线程,不再是匿名小 AI;
    // 顺手点亮上下文桥 + 展开 dock,让店主看见「同一个 Otto」刚做了这件事。
    askOttoInline(
      "Research my site and refresh brand memory.",
      `Done — I read your site and added ${RESEARCHED_FACTS.length} facts to brand memory. Review them in the About, Offers and Rules tabs.`,
      { view: "Brand memory" },
    );
    immersive?.openOtto();
  };

  const finishIngest = () => {
    setProducts((prev) =>
      prev.some((p) => p.id === INGESTED_PRODUCT.id) ? prev : [INGESTED_PRODUCT, ...prev],
    );
    setLanded((prev) => ({ ...prev, [INGESTED_PRODUCT.id]: "sweep" }));
    setOttoJob(null);
    setIngestUrl("");
  };

  const addFact = (tabKey: MemoryTabKey, text: string) => {
    const id = `mf-new-${tabKey}-${text.length}-${facts.length}`;
    setFacts((prev) => [...prev, { id, text, tab: tabKey, source: "owner", addedAt: "2026-07-07" }]);
    setLanded((prev) => ({ ...prev, [id]: "land" }));
  };

  const updateFact = (id: string, text: string) => {
    setFacts((prev) => prev.map((f) => (f.id === id ? { ...f, text } : f)));
  };

  const removeFact = (fact: MemoryFact) => {
    const idx = facts.findIndex((f) => f.id === fact.id);
    setFacts((prev) => prev.filter((f) => f.id !== fact.id));
    toast("Removed from brand memory", {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () =>
          setFacts((prev) => {
            const next = [...prev];
            next.splice(Math.min(idx, next.length), 0, fact);
            return next;
          }),
      },
    });
  };

  const tabCounts: Record<MemoryTabKey, number> = {
    about: facts.filter((f) => f.tab === "about").length,
    look: facts.filter((f) => f.tab === "look").length,
    customers: MEMORY_SEGMENTS.length,
    products: products.length,
    offers: facts.filter((f) => f.tab === "offers").length,
    rules: facts.filter((f) => f.tab === "rules").length,
  };

  const visibleProducts = products.filter((p) => productCat === "All" || p.category === productCat);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Brand memory"
        subtitle="What Otto knows about your shop. It shapes everything Otto makes."
        meta={["Updated 2h ago"]}
        actions={
          /* O-04 自养入口:按下即开始 Otto 工作 → 允许 brand 键(§O4 一屏至多一颗) */
          <Button
            variant="brand"
            size="sm"
            disabled={ottoJob !== null}
            onClick={() => setOttoJob("research")}
          >
            {ottoJob === "research" ? "Researching…" : "Research my site"}
          </Button>
        }
      />

      {/* §8c 叙述条:一屏一条,钉在 Otto 正在动的面顶部 */}
      {ottoJob === "research" && (
        <OttoNarrationBar
          key="research"
          steps={RESEARCH_STEPS}
          stepMs={1400}
          counter
          onSettle={finishResearch}
          className="mt-4 self-start"
        />
      )}

      {/* 连接器 O-04:Otto 从赞/踩学到的偏好(带来源)。空则不出现;赞踩即刻现新条目。 */}
      {learned.length > 0 && (
        <section className="mt-6 rounded-[var(--radius-card)] border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <OttoMark label="What Otto learned from your feedback" />
            <span className="ml-auto font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground tabular-nums">
              {learned.length}
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {learned.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-3 rounded-[14px] bg-secondary/60 px-3 py-2.5"
              >
                <span
                  className={
                    p.feedback === "like"
                      ? "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground"
                      : "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-error-soft text-error-soft-foreground"
                  }
                >
                  {p.feedback === "like" ? (
                    <ThumbsUp className="size-3.5" strokeWidth={2} />
                  ) : (
                    <ThumbsDown className="size-3.5" strokeWidth={2} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-[20px] text-foreground">{p.note}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    From {p.source} · {p.assetTitle}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ZoneTabs
        className="mt-6"
        value={tab}
        onChange={(k) => setTab(k as MemoryTabKey)}
        tabs={MEMORY_TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: tabCounts[t.key],
          ottoDot: t.key === "about" && aboutDot,
        }))}
      />

      <div className="mt-6 flex flex-1 flex-col">
        {demo === "loading" && (
          <div className="flex flex-col gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-2" role="status" aria-label="Loading">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton shimmer={i < 3} className="h-4 w-full max-w-[520px]" />
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
            ))}
          </div>
        )}

        {demo === "empty" && (
          <EmptyState
            icon={BookOpen}
            title="Otto knows nothing about your shop yet"
            body="Describe your brand below, or let Otto research your site."
            action={
              <Button variant="brand" size="sm" onClick={() => setDemo("normal")}>
                Research my site
              </Button>
            }
          />
        )}

        {demo === "error" && (
          <ErrorPanel message="Couldn't load brand memory. Try again." onRetry={() => setDemo("normal")} />
        )}

        {demo === "normal" && (
          <>
            {FACT_TABS.includes(tab) && (
              <FactList
                facts={facts.filter((f) => f.tab === tab)}
                landed={landed}
                onAdd={(text) => addFact(tab, text)}
                onUpdate={updateFact}
                onRemove={removeFact}
              />
            )}

            {tab === "customers" && (
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                {MEMORY_SEGMENTS.map((seg) => (
                  <div key={seg.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-card p-6">
                    <p className="text-base font-semibold text-foreground">{seg.name}</p>
                    <p className="text-[13px] leading-[18px] text-muted-foreground">{seg.description}</p>
                    <p className="mt-auto pt-2 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground">
                      {seg.usedIn}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {tab === "products" && (
              <div className="flex flex-col gap-4">
                {/* #124 产品链接一键建档:贴 URL → Otto 草拟档案(双模等价,$0) */}
                <form
                  className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (ottoJob === null && ingestUrl.trim() !== "") setOttoJob("ingest");
                  }}
                >
                  <div className="flex min-w-[240px] flex-1 flex-col gap-2">
                    <label htmlFor="bm-ingest-url" className="text-[13px] leading-[18px] font-semibold text-foreground">
                      Add a product from a link
                    </label>
                    <Input
                      id="bm-ingest-url"
                      type="url"
                      value={ingestUrl}
                      onChange={(e) => setIngestUrl(e.target.value)}
                      placeholder="https://rotibulan.my/products/teh-tarik-cookies"
                      disabled={ottoJob !== null}
                    />
                  </div>
                  <Button type="submit" disabled={ottoJob !== null || ingestUrl.trim() === ""}>
                    <Link2 strokeWidth={2} />
                    {ottoJob === "ingest" ? "Adding…" : "Add from link"}
                  </Button>
                  {ottoJob === "ingest" && (
                    <OttoNarrationBar
                      key="ingest"
                      steps={INGEST_STEPS}
                      stepMs={1200}
                      counter
                      onSettle={finishIngest}
                      className="w-full"
                    />
                  )}
                </form>

                <SegChips
                  options={MEMORY_PRODUCT_CATEGORIES.map((c) => ({ key: c, label: c }))}
                  value={productCat}
                  onChange={setProductCat}
                  ariaLabel="Filter products by category"
                />

                {visibleProducts.length === 0 ? (
                  <EmptyState icon={BookOpen} title="Nothing matches this filter." />
                ) : (
                  <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                    {visibleProducts.map((p) => {
                      const card = <ProductCard product={p} draft={p.id === INGESTED_PRODUCT.id} />;
                      return landed[p.id] ? (
                        <SweepIn key={`${p.id}-landed`} className="rounded-[var(--radius-card)]">
                          {card}
                        </SweepIn>
                      ) : (
                        <div key={p.id}>{card}</div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <MockNote path="/northstar/assets/brand-memory" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

/* ── living collection:事实行(读/改/删/增) ───────────────────────────── */
function FactList({
  facts,
  landed,
  onAdd,
  onUpdate,
  onRemove,
}: {
  facts: MemoryFact[];
  landed: Record<string, "sweep" | "land">;
  onAdd: (text: string) => void;
  onUpdate: (id: string, text: string) => void;
  onRemove: (fact: MemoryFact) => void;
}) {
  const [draft, setDraft] = React.useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {facts.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            Nothing here yet. Add the first note below.
          </p>
        ) : (
          facts.map((f, i) => {
            const row = (
              <FactRow fact={f} first={i === 0 && !landed[f.id]} onUpdate={onUpdate} onRemove={onRemove} />
            );
            return landed[f.id] ? (
              <SweepIn key={`${f.id}-landed`} sweep={landed[f.id] === "sweep"}>
                {row}
              </SweepIn>
            ) : (
              <div key={f.id}>{row}</div>
            );
          })
        )}
      </div>

      {/* 单行输入:Enter 提交(§F9;composer 约定只属于聊天面) */}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text === "") return;
          onAdd(text);
          setDraft("");
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add something Otto should remember"
          aria-label="Add to brand memory"
          className="max-w-[480px]"
        />
        <Button type="submit" variant="secondary" disabled={draft.trim() === ""}>
          <Plus strokeWidth={2} />
          Add
        </Button>
      </form>
    </div>
  );
}

function FactRow({
  fact,
  first,
  onUpdate,
  onRemove,
}: {
  fact: MemoryFact;
  first: boolean;
  onUpdate: (id: string, text: string) => void;
  onRemove: (fact: MemoryFact) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(fact.text);

  if (editing) {
    return (
      <div className={`flex flex-col gap-2 px-4 py-3 ${first ? "" : "border-t border-border"}`}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Edit note" />
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setText(fact.text);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (text.trim() !== "") onUpdate(fact.id, text.trim());
              setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 ${first ? "" : "border-t border-border"}`}>
      <p className="min-w-0 flex-1 text-sm leading-[20px] text-foreground">{fact.text}</p>
      {fact.source === "otto" ? (
        <OttoMark label={`Otto · ${fact.addedAt === "2026-07-07" ? "just now" : shortDate(fact.addedAt)}`} />
      ) : (
        <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground">
          You · {shortDate(fact.addedAt)}
        </span>
      )}
      <div className="flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label="Edit note"
          onClick={() => setEditing(true)}
          className="flex size-8 items-center justify-center rounded-[8px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Pencil className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Remove note"
          onClick={() => onRemove(fact)}
          className="flex size-8 items-center justify-center rounded-[8px] text-muted-foreground outline-none hover:bg-error-soft hover:text-error-soft-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Trash2 className="size-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function ProductCard({ product, draft }: { product: NsProduct; draft: boolean }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
      {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
      <img src={product.image} alt={product.name} className="aspect-square w-full object-cover" />
      <div className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{product.name}</p>
          {draft ? (
            <Badge variant="warning">Draft</Badge>
          ) : product.bestSeller ? (
            <Badge variant="success">Best seller</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{product.category}</p>
        <p className="text-sm font-medium text-foreground tabular-nums">
          RM {product.priceMyr.toFixed(2)}
        </p>
        <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">{product.description}</p>
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]}`;
}
