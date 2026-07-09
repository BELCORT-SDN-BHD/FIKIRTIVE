/* @nsPage district="资产区" page="my-stuff" status="draft"
   sources="区划图·资产区(#103/#129)" approvedAt="" pr="" */
"use client";

/**
 * My Stuff — 我的全部素材一处管(P0 · live·revamp)
 * 清单要素:统一素材网格(生成 + 上传)、失败任务可恢复(Retry → 生成态 → sweep 落地)、
 * 筛选(kind 分段 + 搜索)+ 密度切换(§L7 唯二密度开关之一)。
 * Otto 出场(§O3 shelves):不放头像;Otto 产物用 ≤16px mark + 落地 sweep。
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Download,
  Film,
  Grid3x3,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
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
import { DemoStateBar, ErrorPanel, GenBar, OttoMark, SearchField, SegChips, SkeletonGrid, SweepIn, type DemoState } from "@/components/northstar/assets/_zone";
import { STUFF_ITEMS, type StuffItem, type StuffKind } from "@/components/northstar/assets/_data";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import { nsPlaceholder } from "@/components/northstar/_mock";

const KIND_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
  { key: "storyboard", label: "Storyboards" },
  { key: "upload", label: "Uploads" },
];

const KIND_ICONS: Record<StuffKind, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  image: ImageIcon,
  video: Film,
  storyboard: Layers,
  upload: Upload,
};

const UPLOADED_ITEM: StuffItem = {
  id: "st-new-upload",
  title: "Counter display photo",
  kind: "upload",
  createdAt: "2026-07-07",
  thumb: nsPlaceholder("New upload", 640, 480, "neutral"),
  byOtto: false,
  status: "ready",
};

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [items, setItems] = React.useState<StuffItem[]>(STUFF_ITEMS);
  const [kind, setKind] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [compact, setCompact] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  /** 失败任务恢复:id → 生成中(计时后翻 ready + sweep) */
  const [retrying, setRetrying] = React.useState<string | null>(null);
  /** 刚落地的条目(带 sweep 或仅降落) */
  const [justLanded, setJustLanded] = React.useState<Record<string, "sweep" | "land">>({});

  const retryTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
  }, []);

  const visible = items.filter(
    (it) =>
      (kind === "all" || it.kind === kind) &&
      (query.trim() === "" || it.title.toLowerCase().includes(query.trim().toLowerCase())),
  );

  const retry = (id: string) => {
    setRetrying(id);
    retryTimer.current = window.setTimeout(() => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "ready" } : it)));
      setJustLanded((prev) => ({ ...prev, [id]: "sweep" }));
      setRetrying(null);
    }, 3500);
  };

  const remove = (item: StuffItem) => {
    const idx = items.findIndex((it) => it.id === item.id);
    setItems((prev) => prev.filter((it) => it.id !== item.id));
    toast(`Removed "${item.title}"`, {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () =>
          setItems((prev) => {
            const next = [...prev];
            next.splice(Math.min(idx, next.length), 0, item);
            return next;
          }),
      },
    });
  };

  const addUpload = () => {
    setUploadOpen(false);
    setItems((prev) => [UPLOADED_ITEM, ...prev.filter((it) => it.id !== UPLOADED_ITEM.id)]);
    setJustLanded((prev) => ({ ...prev, [UPLOADED_ITEM.id]: "land" }));
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="My stuff"
        subtitle="Everything you've made or uploaded, in one place."
        meta={[`${items.length} items`]}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload strokeWidth={2} />
            Upload
          </Button>
        }
      />

      {/* 工具条:搜索 + kind 分段 + 密度(§L7 图库密度开关是钦定例外) */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search my stuff" />
        <SegChips options={KIND_FILTERS} value={kind} onChange={setKind} ariaLabel="Filter by type" />
        <div className="ml-auto flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5">
          <button
            type="button"
            aria-label="Comfortable grid"
            aria-pressed={!compact}
            onClick={() => setCompact(false)}
            className={cn(
              "flex size-[30px] items-center justify-center rounded-[8px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              !compact ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <LayoutGrid className="size-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Compact grid"
            aria-pressed={compact}
            onClick={() => setCompact(true)}
            className={cn(
              "flex size-[30px] items-center justify-center rounded-[8px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              compact ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Grid3x3 className="size-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 三态齐全(harmony-06 §一):header/工具条永远在场,状态活在 body */}
      <div className="mt-6 flex flex-1 flex-col">
        {demo === "loading" && <SkeletonGrid count={8} minPx={compact ? 120 : 220} />}

        {demo === "empty" && (
          <EmptyState
            icon={ImageIcon}
            title="No visuals yet"
            body="Make one in the canvas or upload your first."
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" asChild>
                  <Link href="/northstar/create/canvas">Open canvas</Link>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
                  Upload
                </Button>
              </div>
            }
          />
        )}

        {demo === "error" && (
          <ErrorPanel
            message="Couldn't load your stuff. Try again."
            onRetry={() => setDemo("normal")}
          />
        )}

        {demo === "normal" &&
          (visible.length === 0 ? (
            <EmptyState icon={ImageIcon} title="Nothing matches this filter." />
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 120 : 220}px, 1fr))` }}
            >
              {visible.map((it) => {
                const landed = justLanded[it.id];
                const card = (
                  <StuffCard
                    item={it}
                    compact={compact}
                    retrying={retrying === it.id}
                    onRetry={() => retry(it.id)}
                    onRemove={() => remove(it)}
                  />
                );
                return landed ? (
                  <SweepIn key={`${it.id}-landed`} sweep={landed === "sweep"} className="rounded-[var(--radius-card)]">
                    {card}
                  </SweepIn>
                ) : (
                  <div key={it.id}>{card}</div>
                );
              })}
            </div>
          ))}
      </div>

      {/* 上传对话框(M 号;拖放区为原型示意) */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Upload files</DialogTitle>
            <DialogDescription>Images and videos up to 100 MB each.</DialogDescription>
          </DialogHeader>
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-secondary/50 text-center">
            <Upload className="size-5 text-muted-foreground" strokeWidth={2} />
            <p className="text-sm text-muted-foreground">Drop files here, or browse</p>
            <p className="text-xs text-muted-foreground">counter-display.jpg selected</p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addUpload}>Add file</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/assets/my-stuff" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

function StuffCard({
  item,
  compact,
  retrying,
  onRetry,
  onRemove,
}: {
  item: StuffItem;
  compact: boolean;
  retrying: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const Kind = KIND_ICONS[item.kind];
  const failed = item.status === "failed" && !retrying;
  const generating = item.status === "generating" || retrying;

  return (
    <div className="group flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
        <img
          src={item.thumb}
          alt={item.title}
          className={cn("aspect-square w-full object-cover", (failed || generating) && "opacity-60")}
        />

        {/* 悬停动作:触屏常显由 focus-within 兜底(§N2 行动作规则同源) */}
        {!failed && !generating && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
            {/* 连接器 1:一键进画布(?from=<id> → canvas 预置会话) */}
            <Link
              href={`/northstar/create/canvas?from=${item.id}`}
              aria-label={`Open ${item.title} in canvas`}
              className="flex size-9 items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground shadow-[var(--shadow-sm)] outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <Sparkles className="size-4" strokeWidth={2} />
            </Link>
            <button
              type="button"
              aria-label={`Download ${item.title}`}
              className="flex size-9 items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground shadow-[var(--shadow-sm)] outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <Download className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={`Remove ${item.title}`}
              onClick={onRemove}
              className="flex size-9 items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground shadow-[var(--shadow-sm)] outline-none hover:bg-error-soft hover:text-error-soft-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <Trash2 className="size-4" strokeWidth={2} />
            </button>
          </div>
        )}

        {/* 失败可恢复(§V3 三槽:发生了什么 · 钱怎样 · 现在怎么办) */}
        {failed && (
          <div className="absolute inset-x-2 bottom-2 flex flex-col gap-2 rounded-[14px] bg-error-soft p-3">
            <p className="text-[13px] leading-[18px] font-medium text-error-soft-foreground">
              {"Couldn't finish this video. You weren't charged."}
            </p>
            <Button variant="secondary" size="sm" className="self-start" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}

        {/* 生成中(§FB8 in-node:coral label + bar + 诚实的钱一行) */}
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

      {!compact && (
        <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Kind className="size-3.5 shrink-0" strokeWidth={2} />
            <span>{item.createdAt.slice(5).replace("-", "/")}</span>
            {typeof item.credits === "number" && item.credits > 0 && (
              <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] tabular-nums">
                {item.credits} cr
              </span>
            )}
            {item.byOtto && <OttoMark className="ml-auto" />}
          </div>
        </div>
      )}
    </div>
  );
}
