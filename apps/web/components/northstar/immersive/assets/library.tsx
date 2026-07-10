"use client";

/**
 * 沉浸式 · Library —— 全部生成产物的历史与回溯(全真图,按日分组)。原生重建。
 * 缩略图 → 详情 overlay → Open in canvas(资产区最主要的「回主场」链路);赞/踩 → Otto 学一条
 * 偏好回灌 Brand memory(连接器 O-04,经 store)。§O3 shelves:byOtto 用 ≤16px mark。
 * [wave-b] B-06 资产库自动打标:每条生成物 AI 标签 chip + 按标签筛选(旧图直接搜复用省 credits)。
 */

import * as React from "react";
import Link from "next/link";
import { Download, Film, History, Image as ImageIcon, Layers, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { GenBar, OttoMark, SearchField, SegChips } from "@/components/northstar/assets/_zone";
import { GEN_RECORDS, LIBRARY_DAY_LABELS, type GenRecord } from "@/components/northstar/assets/_data";
import { FeedbackControls, type FeedbackValue } from "@/components/northstar/create/_create-ui";
import { brandPreferences, setBrandPreference, studioGenRecords, useStore } from "../_store";
import { autoTagsFor, libraryTagCounts } from "./data";
import { PageHeader, EmptyState, AssetsNav, ASSETS_BASE } from "./kit";

const KIND_FILTERS = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
  { key: "storyboard", label: "Storyboards" },
];

const KIND_ICONS: Record<GenRecord["kind"], React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  image: ImageIcon,
  video: Film,
  storyboard: Layers,
};

const DAY_ORDER: GenRecord["day"][] = ["today", "yesterday", "earlier"];

export function AssetsLibrary() {
  useStore();
  const [kind, setKind] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const tagCounts = React.useMemo(() => libraryTagCounts(), []);

  // [fix gate4/factory H2] 合并渲染:运行时工厂产物(共享 store)+ 静态种子 GEN_RECORDS。
  // Factory/Bulk 完工把成品 push 进 studioGenRecords();这里映射成 GenRecord 形状排在最前。
  // 每次渲染即读(记录仅几条,不 memo):useStore() 使 push 后的 notify 触发本页重渲染,
  // 新产物立刻现;记录活在模块级单例,离开工厂再回来仍在。
  const records: GenRecord[] = [
    ...studioGenRecords().map((g): GenRecord => ({
      id: g.id,
      title: g.title,
      kind: g.kind,
      prompt: g.prompt,
      canvas: "Factory",
      createdAt: g.createdAt,
      day: "today",
      thumb: g.thumb,
      credits: g.credits,
      byOtto: true,
      variants: g.variants,
      status: "ready",
    })),
    ...GEN_RECORDS,
  ];

  const visible = records.filter((r) => {
    if (kind !== "all" && r.kind !== kind) return false;
    if (query.trim() !== "" && !r.title.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (tagFilter && !autoTagsFor(r).includes(tagFilter as never)) return false;
    return true;
  });
  const open = records.find((r) => r.id === openId) ?? null;

  const openPref = open
    ? brandPreferences().find((p) => p.assetTitle === open.title && p.source === "Library")
    : null;
  const openFeedback: FeedbackValue = openPref ? (openPref.feedback === "like" ? "up" : "down") : null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Library"
        subtitle="Every generation, newest first. Open one to keep working on it."
        actions={<AssetsNav />}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search generations" />
        <SegChips options={KIND_FILTERS} value={kind} onChange={setKind} ariaLabel="Filter by type" />
        <span className="text-xs text-muted-foreground">{records.length} generations</span>
      </div>

      {/* [wave-b] B-06:AI 自动标签筛选 —— Otto 打好的标签,一键搜旧图复用 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Tag className="size-3.5" strokeWidth={2} />
          Auto-tagged by Otto
        </span>
        <button
          type="button"
          onClick={() => setTagFilter(null)}
          className={cn(
            "h-7 rounded-full border px-3 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            tagFilter === null
              ? "ns-human-soft border-transparent"
              : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          All
        </button>
        {tagCounts.map(({ tag, count }) => (
          <button
            key={tag}
            type="button"
            onClick={() => setTagFilter((t) => (t === tag ? null : tag))}
            className={cn(
              "h-7 rounded-full border px-3 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              tagFilter === tag
                ? "ns-human-soft border-transparent"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tag}
            <span className="ml-1 font-mono text-[10px] tabular-nums opacity-70">{count}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-1 flex-col gap-8">
        {visible.length === 0 ? (
          <EmptyState icon={History} title="Nothing matches this filter." />
        ) : (
          DAY_ORDER.map((day) => {
            const rows = visible.filter((r) => r.day === day);
            if (rows.length === 0) return null;
            return (
              <section key={day}>
                <h2 className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  {LIBRARY_DAY_LABELS[day]}
                </h2>
                <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                  {rows.map((r) => (
                    <RecordCard key={r.id} record={r} onOpen={() => setOpenId(r.id)} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>

      {/* 生成详情 — 回到源画布的门 */}
      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.title}</DialogTitle>
                <DialogDescription>
                  Made {Number(open.createdAt.slice(8, 10))} Jul at {open.createdAt.slice(11, 16)} · from canvas{" "}
                  {open.canvas}
                </DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[280px] items-center justify-center overflow-hidden rounded-[14px] border border-border bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
                <img src={open.thumb} alt={open.title} className="max-h-[280px] w-auto object-contain" />
              </div>
              <div className="flex flex-col gap-3">
                <div className="rounded-[14px] bg-secondary/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Prompt</p>
                  <p className="mt-1 text-sm leading-[20px] text-foreground">{open.prompt}</p>
                </div>
                {/* [wave-b] B-06:这条自动标签在详情也可见 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Tags</span>
                  {autoTagsFor(open).map((t) => (
                    <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                      {t}
                    </span>
                  ))}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Cost</dt>
                    <dd className="font-medium text-foreground tabular-nums">
                      {open.credits === 0 ? "Free" : `${open.credits} credits`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Variants</dt>
                    <dd className="font-medium text-foreground tabular-nums">{open.variants}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Made by</dt>
                    <dd className="font-medium text-foreground">{open.byOtto ? "Otto" : "You"}</dd>
                  </div>
                </dl>
                <div className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">Was this a good result?</p>
                    <p className="text-[11px] leading-4 text-muted-foreground">Otto remembers it in Brand memory.</p>
                  </div>
                  <FeedbackControls
                    value={openFeedback}
                    onChange={(v) =>
                      setBrandPreference({
                        assetId: open.id,
                        assetTitle: open.title,
                        source: "Library",
                        feedback: v === "up" ? "like" : v === "down" ? "dislike" : null,
                      })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                {/* [wave-b] B-10 内容审批流:发布前送人过目(SMB 形状=老板手机点头再发;
                    驳回理由自动喂回 B-04 品牌记忆)。原型层=送审队列的最轻闭环。 */}
                <Button
                  variant="secondary"
                  onClick={() =>
                    toast(`Sent "${open.title}" for approval`, {
                      description: "Aisyah gets it on WhatsApp. A rejection reason feeds back into Brand memory.",
                    })
                  }
                >
                  Send for approval
                </Button>
                <Button variant="secondary" onClick={() => toast(`Downloaded "${open.title}"`)}>
                  <Download strokeWidth={2} />
                  Download
                </Button>
                <Button className="ns-pressable" asChild>
                  <Link href={`${ASSETS_BASE}/create/canvas?from=${open.id}`}>Open in canvas</Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecordCard({ record, onOpen }: { record: GenRecord; onOpen: () => void }) {
  const Kind = KIND_ICONS[record.kind];
  const generating = record.status === "generating";
  const tags = autoTagsFor(record).slice(0, 2);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-[var(--radius-card)] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
        <img
          src={record.thumb}
          alt={record.title}
          className={cn(
            "aspect-square w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]",
            generating && "opacity-60",
          )}
        />
        {!generating && (
          <div className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-[var(--shadow-sm)]">
                {t}
              </span>
            ))}
          </div>
        )}
        {generating && (
          <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5 rounded-[14px] border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-brand-soft-foreground">Generating…</span>
              <GenBar className="ml-auto" />
            </div>
            <p className="text-[11px] leading-[14px] text-muted-foreground">Billed only when it finishes.</p>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <p className="truncate text-sm font-semibold text-foreground">{record.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Kind className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="tabular-nums">{record.createdAt.slice(11, 16)}</span>
          {record.credits > 0 && (
            <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] tabular-nums">
              {record.credits} cr
            </span>
          )}
          {record.byOtto && <OttoMark className="ml-auto" />}
        </div>
      </div>
    </button>
  );
}
