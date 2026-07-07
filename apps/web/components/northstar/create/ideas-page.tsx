"use client";

/**
 * 想法清单(极轻)— N (Buffer) Ideas 判决;campaign spec §一.3
 * 明判不建 Buffer 式管道:一列清单,零阶段零看板。
 * 想法 → canvas 生成入口(一键转创作,$0;生成在 canvas 才花钱);
 * campaign 备选点子自动落入(Otto 落卡:叙述条 + landing + sweep)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Lightbulb, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader } from "../_shared";
import { NS_IDEA_DROPS, NS_IDEAS, type NsIdea } from "./_fixtures";
import {
  DemoStateBar,
  ErrorPanel,
  LAND_STYLE,
  Skeleton,
  SWEEP_STYLE,
  useCreateKeyframes,
  type DemoState,
} from "./_create-ui";

type Filter = "all" | "open" | "converted";

export function IdeasPage() {
  useCreateKeyframes();
  const [ideas, setIdeas] = React.useState<NsIdea[]>(NS_IDEAS);
  const [draft, setDraft] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [demo, setDemo] = React.useState<DemoState>("live");
  const [ottoDropping, setOttoDropping] = React.useState(false);
  const [sweepIds, setSweepIds] = React.useState<string[]>([]);
  const [undoIdea, setUndoIdea] = React.useState<NsIdea | null>(null);
  const dropped = React.useRef(false);
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // campaign 备选点子自动落入(一次):4s 后 Otto 开始,叙述条走完 → 落卡 + sweep
  React.useEffect(() => {
    if (dropped.current) return;
    const t = window.setTimeout(() => {
      if (dropped.current) return;
      dropped.current = true;
      setOttoDropping(true);
    }, 4000);
    timers.current.push(t);
    return () => window.clearTimeout(t);
  }, []);

  const landDrops = React.useCallback(() => {
    setOttoDropping(false);
    setIdeas((prev) => [...NS_IDEA_DROPS, ...prev]);
    setSweepIds(NS_IDEA_DROPS.map((d) => d.id));
    const t = window.setTimeout(() => setSweepIds([]), 650);
    timers.current.push(t);
  }, []);

  const addIdea = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setIdeas((prev) => [
      { id: `id-u-${prev.length + 1}`, text, source: "you", addedAt: "2026-07-07", converted: false },
      ...prev,
    ]);
    setDraft("");
  };

  const convert = (id: string) => {
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, converted: true } : i)));
  };

  const remove = (idea: NsIdea) => {
    setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
    setUndoIdea(idea);
    const t = window.setTimeout(() => setUndoIdea((u) => (u?.id === idea.id ? null : u)), 8000);
    timers.current.push(t);
  };

  const openCount = ideas.filter((i) => !i.converted).length;
  const visible =
    filter === "all" ? ideas : ideas.filter((i) => (filter === "open" ? !i.converted : i.converted));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Ideas"
        subtitle="A light list so ideas don't sink. One tap turns one into a creation."
        meta={[`${openCount} open`]}
        actions={<DemoStateBar state={demo} onChange={setDemo} />}
      />

      {demo === "error" ? (
        <ErrorPanel className="mt-6" what="Couldn't load your ideas." onRetry={() => setDemo("live")} />
      ) : (
        <>
          {/* 记一条(单行输入:Enter 提交) */}
          <form onSubmit={addIdea} className="mt-6 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Film the rain-on-awning kopi shot…"
              aria-label="New idea"
              className="h-11 min-w-0 flex-1 rounded-[14px] border border-input bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
            <Button type="submit" className="h-11">
              Add idea
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Ideas are free. Turning one into a creation opens the canvas, where generation asks before it spends.
          </p>

          {/* 过滤(segmented:同一内容换个看法,不进 URL) */}
          <div className="mt-5 flex items-center gap-3">
            <div className="flex rounded-[10px] border border-border bg-card p-0.5">
              {(
                [
                  ["all", "All"],
                  ["open", "Open"],
                  ["converted", "On canvas"],
                ] as const
              ).map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "h-[30px] rounded-lg px-3 text-xs font-semibold transition-colors duration-[120ms]",
                    filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {ottoDropping && (
              <OttoNarrationBar
                steps={["Reading the campaign plan…", "Saving 2 backup ideas…"]}
                stepMs={1600}
                onSettle={landDrops}
                className="w-fit"
              />
            )}
            {undoIdea && (
              <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[13px] text-foreground shadow-[var(--shadow-xs)]" style={LAND_STYLE}>
                Idea deleted
                <button
                  type="button"
                  onClick={() => {
                    setIdeas((prev) => [undoIdea, ...prev]);
                    setUndoIdea(null);
                  }}
                  className="font-semibold underline underline-offset-2"
                >
                  Undo
                </button>
              </span>
            )}
          </div>

          {/* 清单(极轻:一列,hairline 行,零阶段) */}
          {demo === "loading" && (
            <div className="mt-4 overflow-hidden rounded-[18px] border border-border bg-card p-4">
              <div className="flex flex-col gap-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} shimmer={i === 0} className="h-12 w-full" />
                ))}
              </div>
            </div>
          )}
          {demo === "empty" && (
            <EmptyState
              icon={Lightbulb}
              title="No ideas yet"
              body="Jot one down above, or ask Otto to suggest a few."
              className="mt-4"
              action={
                <Button variant="secondary" size="sm" onClick={() => setDemo("live")}>
                  Show example ideas
                </Button>
              }
            />
          )}
          {demo === "live" &&
            (visible.length === 0 ? (
              <p className="mt-6 text-[13px] text-muted-foreground">Nothing matches this filter.</p>
            ) : (
              <ul className="mt-4 overflow-hidden rounded-[18px] border border-border bg-card">
                {visible.map((idea, i) => (
                  <li
                    key={idea.id}
                    className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}
                    style={sweepIds.includes(idea.id) ? SWEEP_STYLE : undefined}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
                      {idea.source === "otto" ? (
                        <OttoAvatar size={16} mood="idle" />
                      ) : (
                        <Lightbulb className="size-4 text-muted-foreground" strokeWidth={2} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm text-foreground", idea.converted && "text-muted-foreground")}>
                        {idea.text}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        {idea.source === "otto" ? "Otto" : "You"} · {idea.addedAt}
                        {idea.campaign ? ` · backup from ${idea.campaign}` : ""}
                      </p>
                    </div>
                    {idea.converted ? (
                      <>
                        <Badge variant="success" className="shrink-0">
                          On canvas
                        </Badge>
                        <Link
                          href="/northstar/create/canvas"
                          className="flex h-8 shrink-0 items-center gap-1 rounded-[10px] px-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          Open
                          <ArrowUpRight className="size-3.5" strokeWidth={2} />
                        </Link>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0 px-3 text-xs"
                        onClick={() => convert(idea.id)}
                      >
                        Create on canvas
                      </Button>
                    )}
                    <button
                      type="button"
                      aria-label={`Delete idea: ${idea.text}`}
                      onClick={() => remove(idea)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-error-soft hover:text-error-soft-foreground"
                    >
                      <Trash2 className="size-4" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </>
      )}

      <MockNote path="/northstar/create/ideas" />
    </div>
  );
}
