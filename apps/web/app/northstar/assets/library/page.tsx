/* @nsPage district="资产区" page="library" status="draft"
   sources="区划图·资产区;g5a spec;GOAL I2" approvedAt="" pr="" */
"use client";

/**
 * Library(生成历史)— 全部生成产物的历史与回溯(P0 · live·revamp)
 * 清单要素:历史网格(按日分组)、缩略图、回到源画布(详情 → Open in canvas)。
 * Otto 出场(§O3 shelves):不放头像;byOtto 用 ≤16px mark;生成中条目走 in-node gen 态。
 */

import * as React from "react";
import Link from "next/link";
import { Download, Film, History, Image as ImageIcon, Layers } from "lucide-react";
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
import { DemoStateBar, ErrorPanel, GenBar, OttoMark, SearchField, SegChips, SkeletonGrid, type DemoState } from "@/components/northstar/assets/_zone";
import { GEN_RECORDS, LIBRARY_DAY_LABELS, type GenRecord } from "@/components/northstar/assets/_data";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";

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

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [kind, setKind] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const visible = GEN_RECORDS.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (query.trim() === "" || r.title.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const open = GEN_RECORDS.find((r) => r.id === openId) ?? null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Library"
        subtitle="Every generation, newest first. Open one to keep working on it."
        meta={[`${GEN_RECORDS.length} generations`]}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search generations" />
        <SegChips options={KIND_FILTERS} value={kind} onChange={setKind} ariaLabel="Filter by type" />
      </div>

      <div className="mt-6 flex flex-1 flex-col gap-8">
        {demo === "loading" && <SkeletonGrid count={8} />}

        {demo === "empty" && (
          <EmptyState
            icon={History}
            title="No generations yet"
            body="Everything you make lands here automatically. Start in the canvas."
            action={
              <Button size="sm" asChild>
                <Link href="/northstar/create/canvas">Open canvas</Link>
              </Button>
            }
          />
        )}

        {demo === "error" && (
          <ErrorPanel message="Couldn't load your library. Try again." onRetry={() => setDemo("normal")} />
        )}

        {demo === "normal" &&
          (visible.length === 0 ? (
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
                  <div
                    className="mt-3 grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
                  >
                    {rows.map((r) => (
                      <RecordCard key={r.id} record={r} onOpen={() => setOpenId(r.id)} />
                    ))}
                  </div>
                </section>
              );
            })
          ))}
      </div>

      {/* 生成详情(L 号)— 回到源画布的门 */}
      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.title}</DialogTitle>
                <DialogDescription>
                  Made {Number(open.createdAt.slice(8, 10))} Jul at {open.createdAt.slice(11, 16)} · from
                  canvas {open.canvas}
                </DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[280px] items-center justify-center overflow-hidden rounded-[14px] border border-border bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
                <img src={open.thumb} alt={open.title} className="max-h-[280px] w-auto object-contain" />
              </div>
              <div className="flex flex-col gap-3">
                <div className="rounded-[14px] bg-secondary/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Prompt</p>
                  <p className="mt-1 text-sm leading-[20px] text-foreground">{open.prompt}</p>
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
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpenId(null)}>
                  Cancel
                </Button>
                <Button variant="secondary">
                  <Download strokeWidth={2} />
                  Download
                </Button>
                <Button asChild>
                  <Link href={`/northstar/create/canvas?from=${open.id}`}>Open in canvas</Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/assets/library" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

function RecordCard({ record, onOpen }: { record: GenRecord; onOpen: () => void }) {
  const Kind = KIND_ICONS[record.kind];
  const generating = record.status === "generating";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-[var(--radius-card)] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
        <img
          src={record.thumb}
          alt={record.title}
          className={cn(
            "aspect-square w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]",
            generating && "opacity-60",
          )}
        />
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
