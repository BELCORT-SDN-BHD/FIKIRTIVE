"use client";

/**
 * 分群 —— 存好的客户筛选器,计数是真的从共享 store 的联系人过滤出来的(不硬编码)。
 * 「New segment」用人话描述这群人 → 确定性规则编译成 chip 预览 + 实时命中数 → 存进 store,
 * 之后可选可删(判决核心「用人话描述→规则编译」的原型体现)。
 * 选一个分群 → 右侧列出命中的客户,每个连回档案;勿扰者标出禁用态(不进群发)。
 * 「Post to this group」带 ?segment= 进排期 composer,受众 chip 已预选。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plus, Send, Sparkles, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, CrmNav, Card, CardHeader, fmtMyr, Initials } from "./kit";
import {
  SEGMENTS,
  compileSegmentPhrase,
  contactMatchesRules,
  ruleLabel,
  type NsSegmentRule,
} from "./data";
import {
  useStore,
  contactsView,
  customSegments,
  addCustomSegment,
  removeCustomSegment,
} from "../_store";
import type { NsContact } from "@/components/northstar/_mock";

interface UnifiedSegment {
  id: string;
  name: string;
  desc: string;
  custom: boolean;
  rules?: NsSegmentRule[];
  filter: (c: NsContact) => boolean;
}

const EXAMPLES = [
  "Wholesale buyers who spent over RM1,000",
  "New contacts on Instagram, active in last 30 days",
  "Regulars on WhatsApp who are okay to message",
];

export function CrmSegments() {
  useStore(); // 订阅共享 store:新联系人 / 自建分群 / 勿扰改动即刻反映
  const contacts = contactsView();
  const custom = customSegments();

  const segments = React.useMemo<UnifiedSegment[]>(() => {
    const builtIn: UnifiedSegment[] = SEGMENTS.map((s) => ({
      id: s.id,
      name: s.name,
      desc: s.desc,
      custom: false,
      filter: s.match,
    }));
    const made: UnifiedSegment[] = custom.map((s) => ({
      id: s.id,
      name: s.name,
      desc: s.phrase,
      custom: true,
      rules: s.rules,
      filter: (c) => contactMatchesRules(c, s.rules),
    }));
    return [...made, ...builtIn];
  }, [custom]);

  const [activeId, setActiveId] = React.useState(segments[0]?.id ?? "");
  const active = segments.find((s) => s.id === activeId) ?? segments[0];
  const members = active ? contacts.filter(active.filter) : [];
  const reachable = members.filter((c) => !c.doNotDisturb).length;

  const [builderOpen, setBuilderOpen] = React.useState(false);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1000px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Segments"
        subtitle="Saved filters over your contacts. Counts update from who's in your book."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setBuilderOpen(true)}>
              <Plus strokeWidth={2} />
              New segment
            </Button>
            <CrmNav />
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit overflow-hidden">
          <CardHeader title="Saved segments" desc={`${segments.length} filters`} />
          {segments.map((seg) => {
            const count = contacts.filter(seg.filter).length;
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
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{seg.name}</p>
                    {seg.custom && <Badge variant="soft">Yours</Badge>}
                  </div>
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
              <div className="flex items-center gap-2">
                {active?.custom && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      removeCustomSegment(active.id);
                      setActiveId(SEGMENTS[0]?.id ?? "");
                    }}
                    aria-label={`Delete ${active.name}`}
                  >
                    <Trash2 strokeWidth={2} />
                    Delete
                  </Button>
                )}
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`${BASE}/schedule/composer?segment=${active?.id ?? ""}`}>
                    <Send strokeWidth={2} />
                    Post to this group
                  </Link>
                </Button>
              </div>
            }
          />

          {active?.custom && active.rules && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-muted/40 px-4 py-3">
              {active.rules.map((r, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-foreground ring-1 ring-border"
                >
                  {ruleLabel(r)}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span>{members.length} contacts match</span>
            <span>{reachable} okay to message · {members.length - reachable} on do not disturb</span>
          </div>

          {members.length > 0 ? (
            members.map((c) => (
              <Link
                key={c.id}
                href={`${BASE}/crm/contact-profile?id=${c.id}`}
                className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-accent"
              >
                <Initials name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                    {c.doNotDisturb && <Badge variant="outline">Do not disturb</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.tags.join(" · ")}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMyr(c.totalOrdersMyr)}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
              </Link>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 border-t border-border py-14 text-center">
              <Users className="size-5 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No contacts match this filter yet.</p>
            </div>
          )}
        </Card>
      </div>

      <SegmentBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        contacts={contacts}
        onSaved={(id) => setActiveId(id)}
      />
    </div>
  );
}

function SegmentBuilder({
  open,
  onOpenChange,
  contacts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contacts: NsContact[];
  onSaved: (id: string) => void;
}) {
  const [phrase, setPhrase] = React.useState("");
  const [name, setName] = React.useState("");

  const rules = React.useMemo(() => compileSegmentPhrase(phrase), [phrase]);
  const matches = React.useMemo(
    () => (rules.length ? contacts.filter((c) => contactMatchesRules(c, rules)) : []),
    [rules, contacts],
  );
  const reachable = matches.filter((c) => !c.doNotDisturb).length;

  const reset = () => {
    setPhrase("");
    setName("");
  };

  const save = () => {
    if (rules.length === 0) return;
    const finalName = name.trim() || defaultName(rules);
    const id = addCustomSegment({ name: finalName, phrase: phrase.trim(), rules });
    reset();
    onOpenChange(false);
    onSaved(id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>
            Describe the group in plain words. We turn it into rules you can see before you save —
            no formulas to learn.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-foreground">Who are you looking for?</span>
            <Textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="Wholesale buyers who spent over RM1,000 on WhatsApp"
              className="min-h-20 rounded-[14px] bg-card text-[15px] leading-[22px]"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPhrase(ex)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles className="size-3.5 text-muted-foreground" strokeWidth={2} />
              Rules we'll use
            </div>
            {rules.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {rules.map((r, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-foreground ring-1 ring-border"
                    >
                      {ruleLabel(r)}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {matches.length} contact{matches.length === 1 ? "" : "s"} match right now ·{" "}
                  {reachable} okay to message
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Try words like “spent over RM500”, “on Instagram”, “active in last 30 days”, or a tag
                like “wholesale”.
              </p>
            )}
          </div>

          {rules.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-foreground">
                Name <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName(rules)}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={rules.length === 0} onClick={save}>
            Save segment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 无名时的兜底名:从第一条规则派生一句人话。 */
function defaultName(rules: NsSegmentRule[]): string {
  return rules.length ? ruleLabel(rules[0]) : "New segment";
}
