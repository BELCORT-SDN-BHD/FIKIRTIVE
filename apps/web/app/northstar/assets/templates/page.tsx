/* @nsPage district="资产区" page="templates" status="draft"
   sources="区划图·资产区;g5b spec;N (Grok) 模板 gallery 判决「以后」" approvedAt="" pr="" */
"use client";

/**
 * Templates — 官方模板库(P0 · live·revamp)
 * 清单要素:模板卡、一键套用(卡 → 详情 → Use template → canvas)。
 * 边界:用户自建 + 分享模板判「以后」,本页不画任何「Create template」入口。
 * Otto 出场(§O3 shelves):零头像、零 coral —— 套用是人类动作,INK 键。
 */

import * as React from "react";
import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
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
  DemoStateBar,
  ErrorPanel,
  SearchField,
  SegChips,
  SkeletonGrid,
  type DemoState,
} from "@/components/northstar/assets/_zone";
import { TEMPLATE_CATEGORIES, TEMPLATE_ITEMS, type TemplateItem } from "@/components/northstar/assets/_data";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [category, setCategory] = React.useState("All");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const visible = TEMPLATE_ITEMS.filter(
    (t) =>
      (category === "All" || t.category === category) &&
      (query.trim() === "" || t.name.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const open = TEMPLATE_ITEMS.find((t) => t.id === openId) ?? null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Templates"
        subtitle="Official starting points, tuned for food and drink shops. Pick one and make it yours."
        meta={[`${TEMPLATE_ITEMS.length} templates`]}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search templates" />
        <SegChips
          options={TEMPLATE_CATEGORIES.map((c) => ({ key: c, label: c }))}
          value={category}
          onChange={setCategory}
          ariaLabel="Filter templates by category"
        />
      </div>

      {/* 三态齐全(harmony-06 §一):header/工具条永远在场,状态活在 body */}
      <div className="mt-6 flex flex-1 flex-col">
        {demo === "loading" && <SkeletonGrid count={8} aspect="aspect-[4/5]" minPx={240} />}

        {demo === "empty" && (
          <EmptyState
            icon={LayoutTemplate}
            title="Templates are on their way"
            body="New ones land here soon. Start from a blank canvas instead."
            action={
              <Button size="sm" asChild>
                <Link href="/northstar/create/canvas">Open canvas</Link>
              </Button>
            }
          />
        )}

        {demo === "error" && (
          <ErrorPanel message="Couldn't load templates. Try again." onRetry={() => setDemo("normal")} />
        )}

        {demo === "normal" &&
          (visible.length === 0 ? (
            <EmptyState icon={LayoutTemplate} title="Nothing matches this filter." />
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
            >
              {visible.map((t) => (
                <TemplateCard key={t.id} template={t} onOpen={() => setOpenId(t.id)} />
              ))}
            </div>
          ))}
      </div>

      {/* 模板详情(M 号)— 一键套用的门:Use template → canvas */}
      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.name}</DialogTitle>
                <DialogDescription>
                  {open.category} · {open.surface}
                </DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[260px] items-center justify-center overflow-hidden rounded-[14px] border border-border bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
                <img src={open.preview} alt={open.name} className="max-h-[260px] w-auto object-contain" />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm leading-[20px] text-foreground">{open.blurb}</p>
                <div className="rounded-[14px] bg-secondary/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">{"What's inside"}</p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {open.includes.map((inc) => (
                      <li key={inc} className="flex items-baseline gap-2 text-sm leading-[20px] text-foreground">
                        <span aria-hidden className="size-1 shrink-0 translate-y-[-2px] rounded-full bg-muted-foreground" />
                        {inc}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpenId(null)}>
                  Cancel
                </Button>
                <Button asChild>
                  <Link href="/northstar/create/canvas">Use template</Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/assets/templates" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

function TemplateCard({ template, onOpen }: { template: TemplateItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-[var(--radius-card)] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
        <img
          src={template.preview}
          alt={template.name}
          className="aspect-[4/5] w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
        />
        <span className="absolute top-2 left-2 inline-flex h-6 items-center rounded-full border border-border bg-card px-2 text-[11px] leading-none font-semibold text-muted-foreground">
          {template.surface}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <p className="truncate text-sm font-semibold text-foreground">{template.name}</p>
        <p className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">{template.blurb}</p>
      </div>
    </button>
  );
}
