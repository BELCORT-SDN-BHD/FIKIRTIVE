"use client";

/**
 * 试驾 —— 店主先扮客户,看 Otto 会怎么答。点一个常见问题或自己打一句,
 * Otto 从知识库 KNOWLEDGE 取答案回你(同一口径,不新造事实)。演示态、零后台。
 * 连回 knowledge 让「答得不对?去改」有真去处。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, Card, Initials, useReducedMotion } from "./kit";
import { TEST_PROMPTS, KNOWLEDGE, knowledgeAnswer } from "./data";

interface Turn {
  id: number;
  from: "you" | "otto";
  text: string;
}

/** 极简匹配:命中知识库关键词就取对应答案,否则给兜底回复(演示态) */
function ottoReply(question: string): string {
  const q = question.toLowerCase();
  const hit = KNOWLEDGE.find((k) =>
    k.question
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.length > 3 && q.includes(w)),
  );
  if (hit) return hit.answer;
  if (q.includes("halal")) return knowledgeAnswer("kb-01");
  if (q.includes("deliver")) return knowledgeAnswer("kb-04");
  if (q.includes("pay")) return knowledgeAnswer("kb-06");
  return "I'll pass that to Aisyah and get back to you shortly. Meanwhile, our pickup is 9am–6pm daily 🥐";
}

export function InboxTestDrive() {
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
    const reply = ottoReply(q);
    if (reduced) {
      setTurns((prev) => [...prev, { id: ottoId, from: "otto", text: reply }]);
    } else {
      window.setTimeout(() => {
        setTurns((prev) => [...prev, { id: ottoId, from: "otto", text: reply }]);
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
            turns.map((t) => (
              <div key={t.id} className={"flex items-end gap-2 " + (t.from === "you" ? "justify-end" : "justify-start")}>
                {t.from === "otto" && <Initials name="Otto Bot" className="size-7 text-[10px]" />}
                <div
                  className={
                    "max-w-[78%] rounded-[16px] px-3.5 py-2.5 text-sm leading-5 " +
                    (t.from === "you"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-foreground")
                  }
                >
                  {t.from === "otto" && (
                    <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                      <Sparkles className="size-3" strokeWidth={2} />
                      Otto
                    </span>
                  )}
                  {t.text}
                </div>
              </div>
            ))
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
