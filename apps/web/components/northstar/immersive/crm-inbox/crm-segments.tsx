"use client";

/**
 * 分群 —— 存好的客户筛选器,计数是真的从 NS_CONTACTS 过滤出来的(不硬编码)。
 * 选一个分群 → 右侧列出命中的客户,每个连回档案(segment → contact-profile)。
 * 「给这群人发一条」连到排期,让分群有真去处。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Send, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, CrmNav, Card, CardHeader, fmtMyr, Initials } from "./kit";
import { SEGMENTS, contactsInSegment } from "./data";

export function CrmSegments() {
  const [activeId, setActiveId] = React.useState(SEGMENTS[0]?.id ?? "");
  const active = SEGMENTS.find((s) => s.id === activeId) ?? SEGMENTS[0];
  const members = active ? contactsInSegment(active) : [];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1000px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Segments"
        subtitle="Saved filters over your contacts. Counts update from who's in your book."
        actions={<CrmNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit overflow-hidden">
          <CardHeader title="Saved segments" desc={`${SEGMENTS.length} filters`} />
          {SEGMENTS.map((seg) => {
            const count = contactsInSegment(seg).length;
            const isActive = seg.id === activeId;
            return (
              <button
                key={seg.id}
                type="button"
                onClick={() => setActiveId(seg.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 border-t border-border px-4 py-3 text-left transition-colors first:border-t-0",
                  isActive ? "bg-secondary" : "hover:bg-accent",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{seg.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{seg.desc}</p>
                </div>
                <Badge variant={isActive ? "default" : "outline"}>{count}</Badge>
              </button>
            );
          })}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title={active?.name ?? "Segment"}
            desc={active?.desc}
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={`${BASE}/schedule/plan`}>
                  <Send strokeWidth={2} />
                  Post to this group
                </Link>
              </Button>
            }
          />
          {members.length > 0 ? (
            members.map((c) => (
              <Link
                key={c.id}
                href={`${BASE}/crm/contact-profile?id=${c.id}`}
                className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-accent"
              >
                <Initials name={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.tags.join(" · ")}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMyr(c.totalOrdersMyr)}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
              </Link>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Users className="size-5 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No contacts match this filter yet.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
