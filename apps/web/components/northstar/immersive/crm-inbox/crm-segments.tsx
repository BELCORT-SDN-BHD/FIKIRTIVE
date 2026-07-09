"use client";

/**
 * 分群 —— 存好的客户筛选器(Z7 endgame)。计数真从共享 store 的联系人过滤,不硬编码。
 * 「New segment」用人话描述 → 确定性规则编译成 chip 预览 + 实时命中数 → 存进 store。
 * 选一个分群 → 右侧命中客户,每个连回档案;勿扰者标出禁用态。「Post to this group」→ 排期。
 *
 * WHATPASS 一·D/F 落点(每条 [wave-b]):
 *  · lifecycle 分群一等公民:内建「Win-back / Hot right now」    [wave-b] lifecycle+流失唤回
 *  · 预建生命周期自动化配方库(欢迎新客 / 唤回 / 复购 / 生日)   [wave-b] 配方库
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Megaphone, Plus, Send, Sparkles, Trash2, Users, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { CRM_INBOX_BASE as BASE, CrmNav, Card, CardHeader, fmtMyr } from "./kit";
import { ContactAvatar } from "./crm-kit";
import {
  compileSegmentPhrase,
  contactMatchesRules,
  ruleLabel,
  type NsSegmentRule,
} from "./data";
import { ALL_SEGMENTS, LIFECYCLE_RECIPES, segmentValueRead } from "./crm-data";
import { OttoAssist } from "../otto-assist";
import type { NsAssistApply } from "../_store";
import {
  useStore,
  contactsView,
  customSegments,
  addCustomSegment,
  removeCustomSegment,
  rules as storeRules,
  addRule,
  toggleAutomationRule,
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
  useStore(); // 订阅共享 store:新联系人 / 自建分群 / 勿扰 / 配方即刻反映
  const contacts = contactsView();
  const custom = customSegments();

  const segments = React.useMemo<UnifiedSegment[]>(() => {
    const builtIn: UnifiedSegment[] = ALL_SEGMENTS.map((s) => ({
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
  const memberRead = segmentValueRead(members);
  const reachable = members.filter((c) => !c.doNotDisturb).length;

  const [builderOpen, setBuilderOpen] = React.useState(false);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit overflow-hidden">
          <CardHeader title="Saved segments" desc={`${segments.length} filters`} />
          {segments.map((seg) => {
            const segMembers = contacts.filter(seg.filter);
            const count = segMembers.length;
            const read = segmentValueRead(segMembers); // [wave-c] 每群一行钱(治 ledger gap#7)
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
                  {count > 0 ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {fmtMyr(read.lifetimeMyr)} lifetime · ~{fmtMyr(read.nextMyr)} next order
                    </p>
                  ) : (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{seg.desc}</p>
                  )}
                </div>
                <Badge variant={isActive ? "default" : "outline"}>{count}</Badge>
              </button>
            );
          })}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title={active?.name ?? "Segment"}
            desc={
              members.length > 0
                ? `${fmtMyr(memberRead.lifetimeMyr)} lifetime · ~${fmtMyr(memberRead.nextMyr)} next order across ${members.length}`
                : active?.desc
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                {active?.custom && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      removeCustomSegment(active.id);
                      setActiveId(ALL_SEGMENTS[0]?.id ?? "");
                    }}
                    aria-label={`Delete ${active.name}`}
                  >
                    <Trash2 strokeWidth={2} />
                    Delete
                  </Button>
                )}
                {/* [wave-c] stall#32:WhatsApp 群发有了明确入口,与「发社媒帖」分清两条路 */}
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`${BASE}/inbox/broadcast?segment=${active?.id ?? ""}`}>
                    <Megaphone strokeWidth={2} />
                    Broadcast to this group
                  </Link>
                </Button>
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
                <ContactAvatar contact={c} />
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

      {/* 生命周期自动化配方库 */}
      <RecipeLibrary />

      <SegmentBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        contacts={contacts}
        onSaved={(id) => setActiveId(id)}
      />
    </div>
  );
}

/* ── 配方库:开一个开关就在跑;写进共享 store 的 rules(automation 区可见) ────── */
function RecipeLibrary() {
  useStore();
  const rules = storeRules();
  // recipeId → 已创建的 rule id(本会话开过的);用规则名回连,跨挂载存活。
  const ruleFor = (recipeName: string) => rules.find((r) => r.name === recipeName);

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader
        title="Lifecycle recipes"
        desc="Ready-made follow-ups. Flip one on and Otto runs it — no flowchart to build."
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`${BASE}/automation/rules`}>
              Manage
              <ArrowRight strokeWidth={2} />
            </Link>
          </Button>
        }
      />
      {LIFECYCLE_RECIPES.map((recipe) => {
        const rule = ruleFor(recipe.name);
        const on = rule?.enabled ?? false;
        const toggle = (v: boolean) => {
          if (rule) {
            toggleAutomationRule(rule.id, v);
          } else if (v) {
            addRule({ name: recipe.name, when: recipe.when, then: recipe.then });
          }
        };
        return (
          <div key={recipe.id} className="flex items-center gap-3 border-t border-border px-4 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
              <Wand2 className="size-4 text-muted-foreground" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{recipe.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                When {recipe.when.toLowerCase()} → {recipe.then}
              </p>
            </div>
            <Switch checked={on} onCheckedChange={toggle} aria-label={`Turn on ${recipe.name}`} />
          </div>
        );
      })}
    </Card>
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

  // [wave-c] Otto 帮我把老板原话落回描述框(编译成 rule 预览在下方实时更新);不自动保存。
  const onPhraseApply = (apply: NsAssistApply) => {
    const next = apply.patch.phrase;
    if (typeof next === "string") setPhrase(next);
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-foreground">Who are you looking for?</span>
              {/* [wave-c] stall#34:词不中时给「Otto 帮我」——把老板原话编译成一句能命中的描述 */}
              <OttoAssist
                zone="CRM"
                entityLabel="New segment"
                formState={{ phrase }}
                label="Otto, help me"
                intents={[
                  {
                    id: "seg-wholesale",
                    label: "Find my wholesale regulars",
                    prompt: "Help me build a segment of my wholesale regulars.",
                    reply: "Try this — it turns into rules you can see before saving:",
                    apply: {
                      summary: "Fill the description with wholesale regulars",
                      patch: { phrase: "Wholesale buyers on WhatsApp who are okay to message" },
                    },
                  },
                  {
                    id: "seg-quiet",
                    label: "Who's gone quiet",
                    prompt: "Help me find good customers who've gone quiet.",
                    reply: "Here's a starting description for quiet spenders — tweak the numbers to taste:",
                    apply: {
                      summary: "Fill the description with quiet spenders",
                      patch: { phrase: "Spent over RM500, active in last 90 days" },
                    },
                  },
                  {
                    id: "seg-top",
                    label: "Top spenders I can message",
                    prompt: "Help me build a segment of top spenders I'm allowed to message.",
                    reply: "This one targets your biggest, contactable customers:",
                    apply: {
                      summary: "Fill the description with contactable top spenders",
                      patch: { phrase: "Spent over RM1,000 and okay to message" },
                    },
                  },
                ]}
                onApply={onPhraseApply}
              />
            </div>
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
                  className="ns-pressable rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
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
