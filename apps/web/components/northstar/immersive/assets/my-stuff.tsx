"use client";

/**
 * 沉浸式 · My stuff —— 我的全部素材一处管(生成 + 上传,全真图)。原生重建。
 * kind 分段 + 搜索 + 密度开关;失败任务 Retry → 生成态 → sweep 落地;item 动作接真去处
 * (Open in canvas / Download / Remove+Undo)。§O3 shelves:不放头像,Otto 产物用 ≤16px mark。
 * [wave-b] B-08 数据驱动批量变体:读商品表 → 逐行成品图 → 批量总价确认闸(缝 7:只画确认形态,永不真扣费)。
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
  Table2,
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
import {
  ErrorPanel,
  GenBar,
  OttoMark,
  SearchField,
  SegChips,
  SweepIn,
} from "@/components/northstar/assets/_zone";
import { type StuffItem, type StuffKind } from "@/components/northstar/assets/_data";
import { nsImage } from "@/components/northstar/_mock";
import {
  useStore,
  myStuffItems,
  myStuffAddItem,
  myStuffRetrySuccess,
  myStuffRemoveItem,
  myStuffRestoreItem,
} from "../_store";
import { BULK_CREDITS_PER_ROW, BULK_SAMPLE_ROWS } from "./data";
import { PageHeader, EmptyState, AssetsNav, ASSETS_BASE, fmtMyr } from "./kit";

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
  thumb: nsImage("storefront", 9),
  byOtto: false,
  status: "ready",
};

export function AssetsMyStuff() {
  useStore();
  // 单源:全部素材读共享 store(上传/重试/删除跨页存活),不再私藏 useState 副本。
  const items = myStuffItems();
  const [kind, setKind] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [compact, setCompact] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [retrying, setRetrying] = React.useState<string | null>(null);
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
      myStuffRetrySuccess(id);
      setJustLanded((prev) => ({ ...prev, [id]: "sweep" }));
      setRetrying(null);
    }, 3200);
  };

  const remove = (item: StuffItem) => {
    const idx = items.findIndex((it) => it.id === item.id);
    myStuffRemoveItem(item.id);
    toast(`Removed "${item.title}"`, {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => myStuffRestoreItem(item, idx),
      },
    });
  };

  const addUpload = () => {
    setUploadOpen(false);
    myStuffAddItem(UPLOADED_ITEM);
    setJustLanded((prev) => ({ ...prev, [UPLOADED_ITEM.id]: "land" }));
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="My stuff"
        subtitle="Everything you've made or uploaded, in one place."
        actions={
          <div className="flex items-center gap-2">
            <AssetsNav />
            <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
              <Table2 strokeWidth={2} />
              Bulk create
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload strokeWidth={2} />
              Upload
            </Button>
          </div>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search my stuff" />
        <SegChips options={KIND_FILTERS} value={kind} onChange={setKind} ariaLabel="Filter by type" />
        <span className="text-xs text-muted-foreground">{items.length} items</span>
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

      <div className="mt-6 flex flex-1 flex-col">
        {visible.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              icon={ImageIcon}
              title="No visuals yet"
              body="Make one in the canvas or upload your first."
              action={
                <Button size="sm" asChild>
                  <Link href={`${ASSETS_BASE}/create/canvas`}>Open canvas</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState icon={ImageIcon} title="Nothing matches this filter." />
          )
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
        )}
      </div>

      {/* 上传对话框 */}
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

      <BulkCreateDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  );
}

/* [wave-b] B-08 数据驱动批量变体:读商品表 → 逐行出成品图 → 批量总价确认闸。
 * 缝 7 铁律:原型只画确认形态,Confirm 不真扣费(把「Otto 先算总价再执行」画给 founder 看)。 */
function BulkCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const rows = BULK_SAMPLE_ROWS;
  const total = rows.length * BULK_CREDITS_PER_ROW;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(640px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Bulk create from your product table</DialogTitle>
          <DialogDescription>
            Otto reads your product list and makes one promo image per row, all in your brand style. You see the total
            before anything runs.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[300px] overflow-y-auto rounded-[14px] border border-border">
          {rows.map((r, i) => (
            <div key={r.sku} className={cn("flex items-center gap-3 px-3 py-2.5", i > 0 && "border-t border-border")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
              <img src={r.thumb} alt={r.product} className="size-10 shrink-0 rounded-[8px] object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.product}</p>
                <p className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground">{r.sku}</p>
              </div>
              <p className="shrink-0 text-sm font-medium tabular-nums text-foreground">{fmtMyr(r.priceMyr)}</p>
              <span className="shrink-0 font-mono text-[10px] tracking-[0.06em] text-muted-foreground tabular-nums">
                {BULK_CREDITS_PER_ROW} cr
              </span>
            </div>
          ))}
        </div>
        {/* 批量总价确认闸(硬性要求:批量确认页显示总价) */}
        <div className="flex items-center justify-between rounded-[14px] bg-secondary/70 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{rows.length} images · one per row</p>
            <p className="text-[11px] leading-4 text-muted-foreground">Billed only for images that finish.</p>
          </div>
          <p className="text-lg font-bold tabular-nums text-foreground">{total} credits</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={() => {
              onOpenChange(false);
              toast(`Otto queued ${rows.length} images`, { description: `Confirm the ${total}-credit cost in Otto to run.` });
            }}
          >
            Confirm and run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
        <img
          src={item.thumb}
          alt={item.title}
          className={cn("aspect-square w-full object-cover", (failed || generating) && "opacity-60")}
        />

        {!failed && !generating && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
            <Link
              href={`${ASSETS_BASE}/create/canvas?from=${item.id}`}
              aria-label={`Open ${item.title} in canvas`}
              className="flex size-9 items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground shadow-[var(--shadow-sm)] outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <Sparkles className="size-4" strokeWidth={2} />
            </Link>
            <button
              type="button"
              aria-label={`Download ${item.title}`}
              onClick={() => toast(`Downloaded "${item.title}"`)}
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
