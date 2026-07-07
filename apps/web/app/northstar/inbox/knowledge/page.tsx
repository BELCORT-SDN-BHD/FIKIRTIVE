/* @nsPage district="收件箱客服区" page="knowledge" status="draft"
   sources="harmony-01 #9;N (HubSpot) 知识库反向回路判决「要」" approvedAt="" pr="" */
"use client";

/**
 * 知识库页 — AI 客服的可读知识文件管理(护栏的溯源对象)。
 * 清单元素:KnowledgeDoc 列表 / 版本 · 从已解决对话沉淀草稿(知识飞轮)。
 *
 * 知识飞轮(harmony-01 #9 / HubSpot 反向回路判决):Otto 从已解决的对话里发现
 *   「知识库还没覆盖」的问题,自动起草一份文档 → 顶部草稿区,店主一键收编或忽略。
 *   收编 → coral sweep 落进已发布列表。这就是「越用越懂你的店」的闭环。
 * 每份文档可展开看版本历史(护栏溯源的对象:回复引用的正是某个 doc 的某个版本)。
 * 三态齐全 · coral 只属于 Otto · 纯展示零后台。
 */

import * as React from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, FileText, Quote, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import {
  DemoStateBar,
  ErrorPanel,
  Skeleton,
  fmtDayDivider,
  useReducedMotion,
  useSweep,
  type DemoState,
} from "@/components/northstar/inbox/kit";
import {
  IB_KNOWLEDGE_DOCS,
  IB_SUGGESTED_DOCS,
  type IbKnowledgeDoc,
  type IbSuggestedDoc,
} from "@/components/northstar/inbox/mock-inbox";

let seq = 200;

function DocCard({ doc, landing, sweepStyle }: { doc: IbKnowledgeDoc; landing?: boolean; sweepStyle?: React.CSSProperties }) {
  const [open, setOpen] = React.useState(false);
  const reduced = useReducedMotion();
  return (
    <div
      className="rounded-[14px] border border-border bg-card"
      style={{
        ...(landing && !reduced ? { animation: "fade-rise 220ms cubic-bezier(0.34,1.56,0.64,1) both" } : undefined),
        ...sweepStyle,
      }}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
          <FileText className="size-4 text-muted-foreground" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-foreground">{doc.title}</h3>
            <span className="inline-flex h-5 items-center rounded-full bg-success-soft px-2 text-[10px] font-semibold text-success-soft-foreground">
              Published
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-[19px] text-muted-foreground">{doc.excerpt}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Quote className="size-3" strokeWidth={2} />
              Cited {doc.citedCount} times
            </span>
            <span>Updated {fmtDayDivider(doc.updated)}</span>
            <span>v{doc.versions[0]?.v}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] px-2 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          History
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} strokeWidth={2} />
        </button>
      </div>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <ol className="flex flex-col gap-2.5">
            {doc.versions.map((v, i) => (
              <li key={v.v} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-1 inline-flex h-5 shrink-0 items-center rounded-full px-1.5 font-mono text-[10px] font-semibold tabular-nums",
                    i === 0 ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  v{v.v}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-[18px] text-foreground">{v.note}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDayDivider(v.date)} · {v.by}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function SuggestedCard({
  doc,
  onAdopt,
  onDismiss,
}: {
  doc: IbSuggestedDoc;
  onAdopt: (doc: IbSuggestedDoc) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="rounded-[14px] border border-brand/25 bg-brand-soft/40 p-4">
      <div className="flex items-start gap-2.5">
        <OttoAvatar size={22} mood="idle" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-foreground">{doc.title}</h3>
            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-card px-2 text-[10px] font-semibold text-brand-soft-foreground">
              <Sparkles className="size-2.5" strokeWidth={2.5} />
              Draft from Otto
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-[19px] text-foreground">{doc.excerpt}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Learned from {doc.fromLabel}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="soft" size="sm" onClick={() => onAdopt(doc)}>
              Add to knowledge base
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDismiss(doc.id)}>
              <X strokeWidth={2} />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("data");
  const [docs, setDocs] = React.useState<IbKnowledgeDoc[]>(IB_KNOWLEDGE_DOCS);
  const [suggested, setSuggested] = React.useState<IbSuggestedDoc[]>(IB_SUGGESTED_DOCS);
  const [landingId, setLandingId] = React.useState<string | null>(null);
  const sweep = useSweep();

  const adopt = (d: IbSuggestedDoc) => {
    const id = `kd-new-${seq++}`;
    const newDoc: IbKnowledgeDoc = {
      id,
      title: d.title,
      status: "published",
      updated: "2026-07-07",
      citedCount: 0,
      excerpt: d.excerpt,
      versions: [{ v: 1, date: "2026-07-07", note: `Adopted from ${d.fromLabel}`, by: "Aisyah" }],
    };
    setDocs((prev) => [newDoc, ...prev]);
    setSuggested((prev) => prev.filter((x) => x.id !== d.id));
    setLandingId(id);
    sweep.fire();
    window.setTimeout(() => setLandingId(null), 800);
  };

  const dismiss = (id: string) => setSuggested((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Knowledge base"
        subtitle="The files Otto reads to answer customers. Every AI reply traces back to a doc here."
        meta={[`${docs.length} docs`]}
        actions={
          <Button size="sm">
            <FileText strokeWidth={2} />
            New doc
          </Button>
        }
      />

      {demo === "loading" && (
        <div className="mt-6 flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-[14px] border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-9 rounded-[10px]" shimmer={i === 0} />
                <div className="flex-1">
                  <Skeleton className="h-4 w-2/5" shimmer={i === 1} />
                  <Skeleton className="mt-2 h-3 w-4/5" shimmer={i === 2} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load your knowledge base." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "empty" && (
        <EmptyState
          icon={BookOpen}
          title="No docs yet"
          body="Write your first doc like menu, hours, or delivery areas, and Otto starts answering customers from it."
          action={
            <Button variant="secondary" size="sm">
              Write a doc
            </Button>
          }
          className="mt-6"
        />
      )}

      {demo === "data" && (
        <div className="mt-6 flex flex-col gap-6">
          {/* 知识飞轮:Otto 起草的待收编草稿 */}
          {suggested.length > 0 && (
            <section>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Suggested by Otto</h2>
                <span className="inline-flex h-5 items-center rounded-full bg-secondary px-2 text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {suggested.length}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Otto spotted questions your docs didn&apos;t cover and drafted answers from how you resolved them.
              </p>
              <div className="mt-3 flex flex-col gap-3">
                {suggested.map((d) => (
                  <SuggestedCard key={d.id} doc={d} onAdopt={adopt} onDismiss={dismiss} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-foreground">Published docs</h2>
            <div className="mt-3 flex flex-col gap-3">
              {docs.map((d) => (
                <DocCard
                  key={d.id}
                  doc={d}
                  landing={d.id === landingId}
                  sweepStyle={d.id === landingId ? sweep.style : undefined}
                />
              ))}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <OttoAvatar size={16} mood="idle" />
              Try a doc in the{" "}
              <Link href="/northstar/inbox/test-drive" className="font-semibold text-foreground hover:underline">
                test drive
              </Link>{" "}
              before customers see it.
            </p>
          </section>
        </div>
      )}

      <DemoStateBar value={demo} onChange={(v) => setDemo(v as DemoState)} />
      <MockNote path="/northstar/inbox/knowledge" />
    </div>
  );
}
