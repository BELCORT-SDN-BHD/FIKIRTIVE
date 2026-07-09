"use client";

/**
 * 试驾 —— 店主先扮客户,看 Otto 会怎么答。点一个常见问题或自己打一句,
 * Otto 从知识库 KNOWLEDGE 取答案回你(同一口径,不新造事实)。演示态、零后台。
 *
 * O-06 答案溯源:每条 Otto 回答挂可点「依据」chip 连回知识库那一条;无匹配则老实说
 * 「没把握,先转人工」——不捏造。
 * 知识飞轮:无依据时可当场「教 Otto 这个答案」→ 存进知识库(addKnowledgeEntry),
 * 知识库页即刻出现新条目,兜底不再是死胡同。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, Card, Initials, useReducedMotion } from "./kit";
import { TEST_PROMPTS, matchKnowledge } from "./data";
import { useStore, addKnowledgeEntry } from "../_store";

interface Turn {
  id: number;
  from: "you" | "otto";
  text: string;
  /** 命中的知识条目 id(挂可点依据 chip);无 = 无依据 */
  sourceId?: string;
  sourceQuestion?: string;
  /** 无依据时保留原问题,供「教 Otto」把答案存进知识库 */
  gapQuestion?: string;
}

const FALLBACK = "I'm not sure about that one, so I won't guess — I'll pass it to the team and someone will get back to you. Our pickup is 9am–6pm daily 🥐";

/** 从最近一问匹配知识库(命中带 source;未命中给老实兜底 + gap 标记)。 */
function ottoAnswer(question: string): Omit<Turn, "id" | "from"> {
  const hit = matchKnowledge(question);
  if (hit) return { text: hit.answer, sourceId: hit.id, sourceQuestion: hit.question };
  return { text: FALLBACK, gapQuestion: question };
}

function OttoTurn({ turn }: { turn: Turn }) {
  const [teaching, setTeaching] = React.useState(false);
  const [answer, setAnswer] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  return (
    <div className="flex items-end gap-2 justify-start">
      <Initials name="Otto Bot" className="size-7 text-[10px]" />
      <div className="max-w-[78%]">
        <div className="rounded-[16px] border border-border bg-card px-3.5 py-2.5 text-sm leading-5 text-foreground">
          <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <Sparkles className="size-3" strokeWidth={2} />
            Otto
          </span>
          {turn.text}
        </div>

        {/* O-06:有依据 → 可点 chip 连回知识库那一条 */}
        {turn.sourceId && (
          <Link
            href={`${BASE}/inbox/knowledge?highlight=${turn.sourceId}`}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <BookOpen className="size-3" strokeWidth={2} />
            Based on “{turn.sourceQuestion}”
          </Link>
        )}

        {/* 无依据 → 老实说不确定 + 当场教 Otto(存进知识库) */}
        {turn.gapQuestion && !saved && (
          teaching ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type the right answer for Otto…"
                className="h-8 text-[13px]"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!answer.trim()}
                onClick={() => {
                  addKnowledgeEntry({ question: turn.gapQuestion as string, answer, sourceLabel: "Added from a test drive" });
                  setSaved(true);
                }}
              >
                Save
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTeaching(true)}
              className="mt-1 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <BookOpen className="size-3" strokeWidth={2} />
              Teach Otto the answer
            </button>
          )
        )}
        {saved && (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <Check className="size-3" strokeWidth={2} />
            Saved to Knowledge — Otto can use it next time
          </span>
        )}
      </div>
    </div>
  );
}

export function InboxTestDrive() {
  useStore();
  const reduced = useReducedMotion();
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const nextId = React.useRef(1);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    const youId = nextId.current++;
    const ottoId = nextId.current++;
    setTurns((prev) => [...prev, { id: youId, from: "you", text: q }]);
    setInput("");
    const reply: Turn = { id: ottoId, from: "otto", ...ottoAnswer(q) };
    if (reduced) {
      setTurns((prev) => [...prev, reply]);
    } else {
      window.setTimeout(() => {
        setTurns((prev) => [...prev, reply]);
      }, 420);
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Test drive Otto"
        subtitle="Ask like a customer would. Otto answers from your knowledge base."
        actions={
          turns.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setTurns([])}>
              <RotateCcw strokeWidth={2} />
              Reset
            </Button>
          ) : undefined
        }
      />

      <Card className="mt-6 flex min-h-[360px] flex-col overflow-hidden">
        <div className="flex-1 space-y-3 p-4">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-[14px] bg-secondary">
                <Sparkles className="size-5 text-muted-foreground" strokeWidth={2} />
              </span>
              <p className="text-sm font-semibold text-foreground">Try a question below</p>
              <p className="max-w-[360px] text-xs text-muted-foreground">Otto answers exactly how it would for a real customer on WhatsApp or Instagram.</p>
            </div>
          ) : (
            turns.map((t) =>
              t.from === "you" ? (
                <div key={t.id} className="flex items-end gap-2 justify-end">
                  <div className="max-w-[78%] rounded-[16px] bg-primary px-3.5 py-2.5 text-sm leading-5 text-primary-foreground">
                    {t.text}
                  </div>
                </div>
              ) : (
                <OttoTurn key={t.id} turn={t} />
              ),
            )
          )}
        </div>

        {/* 常见问题快捷 */}
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {TEST_PROMPTS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => ask(p.label)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 输入 */}
        <form
          className="flex items-center gap-2 border-t border-border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a question like a customer would…"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button type="submit" size="sm" disabled={!input.trim()}>
            <Send strokeWidth={2} />
            Ask
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Answer not quite right?{" "}
        <Link href={`${BASE}/inbox/knowledge`} className="inline-flex items-center gap-1 font-semibold text-foreground hover:underline">
          Edit the knowledge base
          <ArrowRight className="size-3" strokeWidth={2} />
        </Link>
      </p>
    </div>
  );
}
