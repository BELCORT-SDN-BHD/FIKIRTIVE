/* @nsPage district="收件箱客服区" page="test-drive" status="draft"
   sources="O-01 + O-06 绑定判决" approvedAt="" pr="" */
"use client";

/**
 * 试驾场 — 对客 AI 上线前的硬前置测试场(O-01 + O-06 绑定判决)。
 * 清单元素:模拟对话 · 溯源可点 · 护栏行为演示。
 *
 * 这是「硬前置」:店主在这里先跟自己的 Otto 对话,亲眼看两条护栏成立,才敢放它对客——
 *   ① 每句答案都能点开溯源(来自哪份 KnowledgeDoc);
 *   ② 遇到钱 / 不确定,Otto 交给人,绝不自己硬答(money-gate 不可绕)。
 * 左边一列护栏检查随对话点亮(pending → passed);右边是模拟对话面板,可选场景一键试驾。
 * coral 只属于 Otto · 纯展示零后台。
 */

import * as React from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Circle, HandCoins, RotateCcw, Send, ShieldCheck, UserRoundCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { OttoNarrationBar, PageHeader, MockNote } from "@/components/northstar/_shared";
import { SourceChip, useReducedMotion, useSweep } from "@/components/northstar/inbox/kit";
import { IB_SCENARIOS, ibDoc, type IbScenario } from "@/components/northstar/inbox/mock-inbox";

interface Turn {
  id: string;
  scenarioId: string;
  customer: string;
  otto?: string;
  sourceDocId?: string;
  guardrail?: "handoff" | "money";
}

let seq = 300;

/* 护栏检查清单:随对话点亮 */
const GUARDS = [
  { key: "grounded", icon: ShieldCheck, label: "Answers come from your knowledge base", hint: "Every reply cites a doc you can open." },
  { key: "money", icon: HandCoins, label: "Money stays with you", hint: "Otto never processes refunds or payments." },
  { key: "handoff", icon: UserRoundCheck, label: "Hands off when unsure", hint: "No knowledge doc, no guess. It fetches a person." },
] as const;
type GuardKey = (typeof GUARDS)[number]["key"];

/* 溯源抽屉:这句来自哪份 KnowledgeDoc(O-06) */
function SourceDrawer({ docId, onClose }: { docId: string | null; onClose: () => void }) {
  const doc = docId ? ibDoc(docId) : undefined;
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-soft-foreground">
            <BookOpen className="size-3.5" strokeWidth={2} />
            Answer source
          </div>
          <DialogTitle>{doc?.title}</DialogTitle>
          <DialogDescription>
            Otto wrote its reply from this doc. In the real inbox this chip opens the exact version it used.
          </DialogDescription>
        </DialogHeader>
        {doc && (
          <div className="rounded-[12px] border border-border bg-secondary/50 p-3 text-[13px] leading-[19px] text-foreground">
            {doc.excerpt}
          </div>
        )}
        {doc && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Version {doc.versions[0]?.v} · cited {doc.citedCount} times
            </span>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/northstar/inbox/knowledge">Open in knowledge base</Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Page() {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [pending, setPending] = React.useState<IbScenario | null>(null);
  const [passed, setPassed] = React.useState<Set<GuardKey>>(new Set());
  const [draft, setDraft] = React.useState("");
  const [landing, setLanding] = React.useState(false);
  const [sourceDocId, setSourceDocId] = React.useState<string | null>(null);

  const reduced = useReducedMotion();
  const sweep = useSweep();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const runScenario = (s: IbScenario) => {
    if (pending) return;
    setTurns((prev) => [...prev, { id: `t-${seq++}`, scenarioId: s.id, customer: s.customer }]);
    setPending(s);
  };

  const runCustom = () => {
    const text = draft.trim();
    if (!text || pending) return;
    // 自由输入映射到 grounded 场景(试驾原型:自由问句默认走知识库演示)
    const s: IbScenario = { ...IB_SCENARIOS[0], id: `custom-${seq}`, customer: text };
    setDraft("");
    runScenario(s);
  };

  const onSettle = () => {
    if (!pending) return;
    const s = pending;
    setTurns((prev) => {
      const idx = prev.findIndex((t) => !t.otto && t.scenarioId === s.id && t.customer === s.customer);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], otto: s.otto, sourceDocId: s.sourceDocId, guardrail: s.guardrail };
      return next;
    });
    setPassed((prev) => {
      const next = new Set(prev);
      if (s.sourceDocId) next.add("grounded");
      if (s.guardrail === "money") next.add("money");
      if (s.guardrail === "handoff") next.add("handoff");
      return next;
    });
    setPending(null);
    setLanding(true);
    sweep.fire();
    window.setTimeout(() => setLanding(false), 700);
  };

  const reset = () => {
    setTurns([]);
    setPassed(new Set());
    setPending(null);
    setDraft("");
  };

  const allPassed = passed.size === GUARDS.length;
  const lastId = turns[turns.length - 1]?.id;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1040px] flex-col px-6 pt-6 pb-4">
      <PageHeader
        title="Test drive"
        subtitle="Talk to your Otto before customers do. Watch the guardrails hold, then ship with confidence."
        actions={
          turns.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw strokeWidth={2} />
              Reset
            </Button>
          ) : undefined
        }
      />

      <div className="mt-5 grid min-h-0 flex-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* 护栏检查清单 */}
        <aside className="flex flex-col gap-3">
          <div className="rounded-[16px] border border-border bg-card p-4">
            <h2 className="text-[13px] font-semibold text-foreground">Pre-launch checks</h2>
            <p className="mt-1 text-[12px] leading-[17px] text-muted-foreground">
              These must hold before Otto talks to customers. Run the scenarios to see each one pass.
            </p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {GUARDS.map((g) => {
                const on = passed.has(g.key);
                const Icon = on ? CheckCircle2 : Circle;
                return (
                  <li key={g.key} className="flex items-start gap-2.5">
                    <Icon
                      className={cn("mt-0.5 size-4 shrink-0", on ? "text-success-soft-foreground" : "text-muted-foreground/50")}
                      strokeWidth={2}
                      style={on && !reduced ? { animation: "fade-rise 200ms cubic-bezier(0.34,1.56,0.64,1) both" } : undefined}
                    />
                    <div className="min-w-0">
                      <p className={cn("text-[13px] leading-[18px] font-medium", on ? "text-foreground" : "text-muted-foreground")}>
                        {g.label}
                      </p>
                      <p className="text-[11px] leading-[15px] text-muted-foreground">{g.hint}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div
            className={cn(
              "rounded-[16px] border p-4 transition-colors",
              allPassed ? "border-success-soft-foreground/30 bg-success-soft" : "border-border bg-secondary/40",
            )}
          >
            {allPassed ? (
              <>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-success-soft-foreground">
                  <ShieldCheck className="size-4" strokeWidth={2} />
                  All checks passed
                </div>
                <p className="mt-1 text-[12px] leading-[17px] text-success-soft-foreground/80">
                  Otto is safe to talk to customers. Turn on AI reply from any conversation.
                </p>
                <Button variant="soft" size="sm" className="mt-3 w-full" asChild>
                  <Link href="/northstar/inbox/shared">Go to inbox</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-[12px] font-semibold text-foreground tabular-nums">
                  {passed.size} of {GUARDS.length} checks passed
                </p>
                <p className="mt-1 text-[12px] leading-[17px] text-muted-foreground">
                  Run every scenario on the right to clear all three before launch.
                </p>
              </>
            )}
          </div>
        </aside>

        {/* 模拟对话面板 */}
        <div className="flex min-h-0 flex-col rounded-[18px] border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <OttoAvatar size={22} mood={pending ? "thinking" : "idle"} />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">Roti Bulan Bakery · Otto</p>
              <p className="text-[11px] text-muted-foreground">Sandbox. Nothing here is sent to a real customer.</p>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {turns.length === 0 && !pending ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-[14px] bg-secondary">
                  <OttoAvatar size={28} mood="idle" />
                </span>
                <p className="text-[15px] font-semibold text-foreground">Pick a scenario to start</p>
                <p className="max-w-[360px] text-[13px] text-muted-foreground">
                  Each one probes a guardrail. Ask a menu question, ask for a refund, ask something Otto can&apos;t
                  know — and watch how it answers.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {turns.map((t) => (
                  <div key={t.id} className="flex flex-col gap-2">
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-[18px] bg-secondary px-4 py-2.5 text-[14px] leading-[20px] text-foreground">
                        {t.customer}
                      </div>
                    </div>
                    {t.otto && (
                      <div className="flex justify-start">
                        <div className="flex max-w-[82%] flex-col gap-1.5">
                          <div
                            className="rounded-[18px] border border-border bg-card px-4 py-3 text-[14px] leading-[20px] text-foreground"
                            style={{
                              ...(t.id === lastId && landing && !reduced
                                ? { animation: "fade-rise 200ms cubic-bezier(0.34,1.56,0.64,1) both" }
                                : undefined),
                              ...(t.id === lastId ? sweep.style : undefined),
                            }}
                          >
                            {t.otto}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 px-1">
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              <OttoAvatar size={14} mood="idle" />
                              Otto
                            </span>
                            {t.sourceDocId && <SourceChip docId={t.sourceDocId} onOpen={setSourceDocId} />}
                            {t.guardrail === "money" && (
                              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-success-soft px-2 text-[11px] font-medium text-success-soft-foreground">
                                <HandCoins className="size-3" strokeWidth={2} />
                                Handed money decision to owner
                              </span>
                            )}
                            {t.guardrail === "handoff" && (
                              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-success-soft px-2 text-[11px] font-medium text-success-soft-foreground">
                                <UserRoundCheck className="size-3" strokeWidth={2} />
                                Handed to a person
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {pending && (
                  <div className="flex justify-start pt-1">
                    <OttoNarrationBar key={turns.length} steps={pending.narration} stepMs={900} onSettle={onSettle} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 场景 chips + 自由输入 */}
          <div className="border-t border-border p-3">
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {IB_SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => runScenario(s)}
                  disabled={!!pending}
                  title={s.check}
                  className="inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-[12px] font-medium text-foreground hover:bg-accent disabled:opacity-40"
                >
                  {s.chip}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-[14px] border border-border bg-background p-1.5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    runCustom();
                  }
                }}
                placeholder="Or type a question as a customer would…"
                rows={1}
                disabled={!!pending}
                className="max-h-24 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-[18px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              <Button size="icon" className="size-8 shrink-0" disabled={!draft.trim() || !!pending} onClick={runCustom} aria-label="Ask Otto">
                <Send strokeWidth={2} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <SourceDrawer docId={sourceDocId} onClose={() => setSourceDocId(null)} />
      <MockNote path="/northstar/inbox/test-drive" />
    </div>
  );
}
