"use client";

/**
 * 知识库 —— Otto 回答客服问题时的依据。按类目分组(产品/取送/付款/品牌),
 * 每条带「本周被用到几次」的轻量佐证。派生自 NS_PRODUCTS + NS_BRAND,不发明品牌事实。
 * 「试一句」连到 test-drive,让店主先扮客户看 Otto 会怎么答。
 */

import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, InboxNav, Card, CardHeader } from "./kit";
import { KNOWLEDGE, knowledgeCategories } from "./data";

export function InboxKnowledge() {
  const categories = knowledgeCategories();
  const totalUses = KNOWLEDGE.reduce((s, k) => s + k.usedThisWeek, 0);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Knowledge"
        subtitle="What Otto knows about your shop. Keep it sharp and answers stay right."
        actions={<InboxNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Entries" value={String(KNOWLEDGE.length)} />
        <StatCard label="Used this week" value={String(totalUses)} />
        <StatCard label="Categories" value={String(categories.length)} />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {categories.map((cat) => {
          const entries = KNOWLEDGE.filter((k) => k.category === cat);
          if (entries.length === 0) return null;
          return (
            <Card key={cat} className="overflow-hidden">
              <CardHeader title={cat} desc={`${entries.length} entr${entries.length > 1 ? "ies" : "y"}`} />
              {entries.map((k) => (
                <div key={k.id} className="border-t border-border px-4 py-3.5 first:border-t-0">
                  <div className="flex items-start gap-2">
                    <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{k.question}</p>
                      <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{k.answer}</p>
                    </div>
                    <Badge variant="outline">Used {k.usedThisWeek}×</Badge>
                  </div>
                </div>
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
