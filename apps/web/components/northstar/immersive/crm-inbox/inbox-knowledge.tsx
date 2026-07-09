"use client";

/**
 * 知识库 —— Otto 回答客服问题时的依据。按类目分组(产品/取送/付款/品牌),
 * 每条带「本周被用到几次」的轻量佐证。派生自 NS_PRODUCTS + NS_BRAND,不发明品牌事实。
 * 「试一句」连到 test-drive,让店主先扮客户看 Otto 会怎么答。
 *
 * 知识反向回路:对话页人工存进来的条目(addedKnowledgeView)在此出现,带「New」+ 来源对话链接。
 * ?highlight=<id>:从建议回复「依据」chip / 保存确认链接跳来时,滚到并 coral 高亮那一条(O-06 溯源可点验证)。
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, BookOpen, Check, HelpCircle, MessageSquare, ShieldCheck, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, InboxNav, Card, CardHeader, useSweep } from "./kit";
import { KNOWLEDGE, knowledgeCategories, type NsKnowledgeEntry } from "./data";
import { GUARDRAILS, KB_PATCHES, unansweredFrom } from "./lifecycle-data";
import {
  useStore,
  addedKnowledgeView,
  conversationsView,
  isGuardrailOn,
  toggleGuardrail,
  kbPatchDecision,
  decideKbPatch,
  type NsKnowledgeAddition,
} from "../_store";

/** [wave-b] AI 客服护栏配置面(话题白名单 + 动作范围声明)。 */
function GuardrailsCard() {
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title="What Otto can do in chat" desc="Guardrails — Otto stays inside these, and everything else comes to you." />
      {GUARDRAILS.map((g) => (
        <div key={g.id} className="flex items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
            <ShieldCheck className="size-4 text-muted-foreground" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{g.label}</p>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{g.detail}</p>
          </div>
          <Switch checked={isGuardrailOn(g.id, g.defaultOn)} onCheckedChange={(on) => toggleGuardrail(g.id, on)} aria-label={g.label} />
        </div>
      ))}
    </Card>
  );
}

/** [wave-b] 未答问题清单:Otto 这周答不上的问题,一键去补。 */
function UnansweredCard() {
  const items = unansweredFrom(conversationsView());
  if (items.length === 0) return null;
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title="Questions Otto couldn't answer" desc={`${items.length} recent question${items.length === 1 ? "" : "s"} with no matching knowledge`} />
      {items.map((u) => (
        <div key={u.conversationId} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
          <HelpCircle className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">“{u.question}”</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{u.subject}</p>
          </div>
          <Button size="sm" variant="secondary" asChild>
            <Link href={`${BASE}/inbox/conversation?id=${u.conversationId}`}>
              Answer &amp; teach
              <ArrowRight strokeWidth={2} />
            </Link>
          </Button>
        </div>
      ))}
    </Card>
  );
}

/** [wave-b] 自愈知识库:Otto 从已解决对话起草的补丁,店主只做是非判断。 */
function SelfHealingCard() {
  const sweep = useSweep();
  const pending = KB_PATCHES.filter((p) => !kbPatchDecision(p.id));
  if (pending.length === 0) return null;
  return (
    <Card className="mt-6 overflow-hidden" style={sweep.style}>
      <CardHeader
        title="Otto drafted these from recent chats"
        desc="Approve to add them to Knowledge — Otto only writes them, you decide."
      />
      {pending.map((p) => (
        <div key={p.id} className="border-t border-border px-4 py-3.5 first:border-t-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Sparkles className="size-3.5" strokeWidth={2} />
            From “{p.sourceLabel}”
          </div>
          <p className="mt-1.5 text-sm font-semibold text-foreground">{p.question}</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{p.answer}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => { decideKbPatch(p, "approved"); sweep.fire(); }}>
              <Check strokeWidth={2} />
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decideKbPatch(p, "rejected")}>
              <X strokeWidth={2} />
              Skip
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

type Entry = NsKnowledgeEntry & Partial<Pick<NsKnowledgeAddition, "sourceConversationId" | "sourceLabel">>;

function KnowledgeRow({ entry, highlight }: { entry: Entry; highlight: boolean }) {
  const sweep = useSweep();
  const ref = React.useRef<HTMLDivElement>(null);
  const isNew = entry.id.startsWith("kb-live-");

  React.useEffect(() => {
    if (highlight) {
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      sweep.fire();
    }
    // 只在挂载 / highlight 变化时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  return (
    <div ref={ref} id={entry.id} className="border-t border-border px-4 py-3.5 first:border-t-0" style={sweep.style}>
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{entry.question}</p>
            {isNew && <Badge variant="success">New</Badge>}
          </div>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{entry.answer}</p>
          {entry.sourceConversationId && (
            <Link
              href={`${BASE}/inbox/conversation?id=${entry.sourceConversationId}`}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:underline"
            >
              <MessageSquare className="size-3" strokeWidth={2} />
              From a conversation{entry.sourceLabel ? ` · ${entry.sourceLabel}` : ""}
            </Link>
          )}
        </div>
        <Badge variant="outline">Used {entry.usedThisWeek}×</Badge>
      </div>
    </div>
  );
}

export function InboxKnowledge() {
  useStore(); // 订阅:对话页存进来的新条目即刻出现
  const params = useSearchParams();
  const highlightId = params.get("highlight");
  const added = addedKnowledgeView();
  const categories = knowledgeCategories();

  const all: Entry[] = [...added, ...KNOWLEDGE];
  const totalUses = all.reduce((s, k) => s + k.usedThisWeek, 0);
  const usedCategories = categories.filter((cat) => all.some((k) => k.category === cat));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Knowledge"
        subtitle="What Otto knows about your shop. Keep it sharp and answers stay right."
        actions={<InboxNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Entries" value={String(all.length)} />
        <StatCard label="Used this week" value={String(totalUses)} />
        <StatCard label="Categories" value={String(usedCategories.length)} />
      </div>

      <SelfHealingCard />
      <UnansweredCard />
      <GuardrailsCard />

      <div className="mt-8 flex flex-col gap-6">
        {usedCategories.map((cat) => {
          // 新存入的排在前(最新),再接种子
          const entries = all.filter((k) => k.category === cat);
          return (
            <Card key={cat} className="overflow-hidden">
              <CardHeader title={cat} desc={`${entries.length} entr${entries.length > 1 ? "ies" : "y"}`} />
              {entries.map((k) => (
                <KnowledgeRow key={k.id} entry={k} highlight={highlightId === k.id} />
              ))}
            </Card>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">See it from your customer&apos;s side</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Ask Otto a question and check the answer before a real customer does.</p>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`${BASE}/inbox/test-drive`}>
            Test drive Otto
            <ArrowRight strokeWidth={2} />
          </Link>
        </Button>
      </div>
    </div>
  );
}
