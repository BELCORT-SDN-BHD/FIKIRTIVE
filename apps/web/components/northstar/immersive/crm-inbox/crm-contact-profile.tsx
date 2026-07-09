"use client";

/**
 * 客户档案 —— 一个客户的全貌(Z7 endgame)。头像用 NS_IMAGES;金额永远走单一源。
 *
 * WHATPASS 一章落点(每条 [wave-b]):
 *  · 多渠道身份合并 + consent/勿扰 + 字段变更留痕(已有,保留)
 *  · Otto 热度 + 生命周期 + 流失风险 + 来源(header chips)      [wave-b] 热度/预测/来源
 *  · 预测字段(avg order / predicted next)作为 stat            [wave-b] 预测字段标签
 *  · 自定义字段(加字段:文本/数字/日期/下拉)                  [wave-b] 自定义字段
 *  · 待办任务(挂客户、到期、勾完成)                          [wave-b] 待办任务
 *  · 极简报价单 + 收款链接(接商家自己账户)                    [wave-b] 报价单+收款链接
 *  · B2B 公司档案链接                                          [wave-b] B2B 公司
 *  · 活动时间线(导入/回复/报价/任务汇成一条流)               [wave-b] 活动时间线
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Copy,
  GitMerge,
  History,
  Inbox,
  ListTodo,
  MessageSquare,
  Plus,
  Receipt,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PageHeader, StatCard, EmptyState } from "@/components/northstar/_shared";
import {
  CRM_INBOX_BASE as BASE,
  ChannelTag,
  Card,
  CardHeader,
  fmtDate,
  fmtMyr,
  type NsInboxChannel,
} from "./kit";
import { ContactAvatar, HeatBadge, LifecycleBadge, ChurnBadge, heatReason } from "./crm-kit";
import { DEAL_STAGES, contactIdentities } from "./data";
import {
  allDealsForContact,
  companyForContact,
  quoteProducts,
  predictedNext,
  predictBasisLabel,
  churnResult,
  winBackDraft,
} from "./crm-data";
import { OttoAssist } from "../otto-assist";
import { avgOrderValue } from "../_selectors";
import type { NsAssistApply } from "../_store";
import {
  useStore,
  contactByIdView,
  contactsView,
  conversationsForContactView,
  contactEventsFor,
  contactChangesFor,
  mergeCandidatesView,
  isInboxContact,
  dealStageOf,
  setContactDnd,
  addContactTag,
  removeContactTag,
  mergeContacts,
  contactFieldsFor,
  addContactField,
  removeContactField,
  contactTodosFor,
  addContactTodo,
  toggleContactTodo,
  quotesFor,
  createQuote,
  markQuotePaid,
  type NsCustomFieldType,
  type NsQuoteLine,
} from "../_store";
import type { NsContact } from "@/components/northstar/_mock";

function StageBadge({ stage }: { stage: (typeof DEAL_STAGES)[number]["id"] }) {
  if (stage === "delivered") return <Badge variant="success">Delivered</Badge>;
  if (stage === "confirmed") return <Badge variant="success">Confirmed</Badge>;
  if (stage === "quote") return <Badge variant="warning">Quote sent</Badge>;
  return <Badge variant="outline">Lead</Badge>;
}

export function CrmContactProfile() {
  const params = useSearchParams();
  useStore(); // 订阅共享 store:身份 / 对话 / 字段 / 任务 / 报价即时反映
  const contacts = contactsView();
  const id = params.get("id") ?? contacts[0]?.id ?? "";
  const contact = contactByIdView(id) ?? contacts[0];

  const [addingTag, setAddingTag] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState("");
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [quoteOpen, setQuoteOpen] = React.useState(false);

  if (!contact) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
        <EmptyState title="Contact not found" body="This contact may have been removed." />
      </div>
    );
  }

  const conversations = conversationsForContactView(contact.id);
  const deals = allDealsForContact(contact.id).map((d) => ({ ...d, stage: dealStageOf(d.id, d.stage) }));
  const delivered = deals.filter((d) => d.stage === "delivered").reduce((s, d) => s + d.amountMyr, 0);
  const timeline = contactEventsFor(contact.id);
  const changes = contactChangesFor(contact.id);
  const identities = contactIdentities(contact);
  const fields = contactFieldsFor(contact.id);
  const todos = contactTodosFor(contact.id);
  const quotes = quotesFor(contact.id);
  const company = companyForContact(contact.id);
  const avg = avgOrderValue(contact.id);
  const predict = predictedNext(contact);
  const churn = churnResult(contact);

  // [wave-c] Otto 帮我(§O7):档案面挂一颗,drafts 用真实字段拼、Apply 落成一条待办(不自动发)
  const onOttoApply = (apply: NsAssistApply) => {
    const todo = apply.patch.todo;
    if (typeof todo === "string" && todo.trim()) addContactTodo(contact.id, todo, "");
  };

  const commitTag = () => {
    const t = tagDraft.trim();
    if (t) addContactTag(contact.id, t);
    setTagDraft("");
    setAddingTag(false);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Contact"
        actions={
          <div className="flex items-center gap-2">
            <OttoAssist
              zone="CRM"
              entityId={contact.id}
              entityLabel={contact.name}
              formState={{ lifecycle: contact.lifecycle, heat: contact.heat, churnBand: churn.band }}
              intents={[
                {
                  id: "crm-winback",
                  label: "Draft a win-back message",
                  prompt: `Draft a gentle win-back message for ${contact.name}.`,
                  reply: `Here's a nudge built from their history — tweak a word and send it yourself:\n\n"${winBackDraft(contact)}"`,
                  apply: {
                    summary: "Add a win-back follow-up task",
                    patch: { todo: `Send ${contact.name.split(" ")[0]} a win-back nudge` },
                  },
                },
                {
                  id: "crm-reorder",
                  label: "Suggest their usual reorder",
                  prompt: `What's ${contact.name}'s usual order and when is it due?`,
                  reply: avg
                    ? `Their orders run about RM${avg} each across ${contact.orderCount ?? 0} so far. A reorder at that size looks like the natural next step.`
                    : `Not enough order history yet to suggest a usual — worth asking what they'd like.`,
                  apply: {
                    summary: "Add a reorder follow-up task",
                    patch: { todo: `Set up ${contact.name.split(" ")[0]}'s usual reorder${avg ? ` (~RM${avg})` : ""}` },
                  },
                },
                {
                  id: "crm-summary",
                  label: "Summarise this customer",
                  prompt: `Give me a one-line read on ${contact.name}.`,
                  reply: `${contact.name}: ${heatReason(contact)} ${churn.band !== "green" ? `Churn — ${churn.bandLabel.toLowerCase()}, ${churn.actionBy.toLowerCase()}.` : "Churn — healthy."}`,
                },
              ]}
              onApply={onOttoApply}
            />
            <Button variant="secondary" size="sm" asChild>
              <Link href={`${BASE}/crm/contacts`}>
                <ArrowLeft strokeWidth={2} />
                All contacts
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="mt-6 p-5">
        <div className="flex items-start gap-4">
          <ContactAvatar contact={contact} className="size-14" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-[-0.02em] text-foreground">{contact.name}</h2>
              {isInboxContact(contact.id) && <Badge variant="warning">New</Badge>}
              {contact.doNotDisturb && <Badge variant="outline">Do not disturb</Badge>}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <HeatBadge heat={contact.heat} />
              <LifecycleBadge stage={contact.lifecycle} />
              <ChurnBadge contact={contact} />
              {company && (
                <Link
                  href={`${BASE}/crm/contact-profile?id=${company.contactIds[0]}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Building2 className="size-3" strokeWidth={2} />
                  {company.name}
                </Link>
              )}
            </div>

            {/* Otto 的一句判断(数据楼,零 coral) */}
            <p className="mt-2 text-xs leading-4 text-muted-foreground">
              <span className="font-semibold text-foreground">Otto's read:</span> {heatReason(contact)}
              {contact.source ? ` Came in via ${contact.source}.` : ""}
            </p>

            {/* [wave-c] 在险解释:churn 分数怎么来的(每条信号带权重,顾问能问「为什么」) */}
            {(churn.band === "orange" || churn.band === "red") && (
              <div className="mt-2 rounded-[10px] border border-border bg-muted/40 px-3 py-2">
                <p className="text-[11px] font-semibold text-error-soft-foreground">
                  {churn.bandLabel} · {fmtMyr(churn.atRiskMyr)} at stake · {churn.actionBy}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {churn.signals.map((s) => (
                    <li key={s.id} className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-mono tabular-nums text-foreground">+{s.weight}</span>
                      <span className="min-w-0 flex-1">{s.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 可编辑标签(留痕) */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {contact.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeContactTag(contact.id, t)}
                    aria-label={`Remove tag ${t}`}
                    className="rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              {addingTag ? (
                <Input
                  autoFocus
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTag();
                    if (e.key === "Escape") {
                      setTagDraft("");
                      setAddingTag(false);
                    }
                  }}
                  onBlur={commitTag}
                  placeholder="New tag"
                  className="h-6 w-28 rounded-full px-2.5 py-0 text-[11px]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTag(true)}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3" strokeWidth={2.5} />
                  Tag
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* §D3 四张数据卡(含预测字段) —— [wave-c] 预测走 predictedNext:静默大客不再显示 RM0 */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Lifetime orders" value={fmtMyr(contact.totalOrdersMyr)} />
        <StatCard label="Avg order" value={avg ? fmtMyr(avg) : "—"} />
        <StatCard
          label="Predicted next"
          value={predict.amountMyr > 0 ? fmtMyr(predict.amountMyr) : "—"}
          delta={predict.amountMyr > 0 ? { dir: "flat", text: predictBasisLabel(predict.basis) } : undefined}
        />
        <StatCard label="Last seen" value={fmtDate(contact.lastSeen)} />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {/* 多渠道身份 + consent/勿扰 + 合并入口 */}
        <Card>
          <CardHeader
            title="Identities"
            desc="Every channel this person reaches you on. Merge if you spot a duplicate."
            action={
              <Button variant="secondary" size="sm" onClick={() => setMergeOpen(true)}>
                <GitMerge strokeWidth={2} />
                Merge duplicate
              </Button>
            }
          />
          {identities.map((idn) => (
            <div key={idn.channel} className="flex items-center gap-3 border-t border-border px-4 py-3">
              <ChannelTag channel={idn.channel as NsInboxChannel} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{idn.label}</p>
                <p className="truncate text-xs text-muted-foreground">{idn.handle}</p>
              </div>
              <Badge variant="outline">Linked</Badge>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Okay to message</p>
              <p className="text-xs text-muted-foreground">
                {contact.doNotDisturb
                  ? "On do not disturb — left out of broadcasts and scheduled sends."
                  : "Included when you post to a segment they're in."}
              </p>
            </div>
            <Switch
              checked={!contact.doNotDisturb}
              onCheckedChange={(v) => setContactDnd(contact.id, !v)}
              aria-label="Okay to message"
            />
          </div>
        </Card>

        {/* 自定义字段 */}
        <CustomFieldsCard contactId={contact.id} fields={fields} />

        {/* 待办任务 */}
        <TasksCard contactId={contact.id} todos={todos} firstName={contact.name.split(" ")[0]} />

        {/* 极简报价单 + 收款链接 */}
        <QuotesCard
          quotes={quotes}
          onNew={() => setQuoteOpen(true)}
        />

        {/* 字段变更留痕(折叠) */}
        {changes.length > 0 && (
          <Card>
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              aria-expanded={historyOpen}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                <History className="size-4 text-muted-foreground" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Change history</p>
                <p className="text-xs text-muted-foreground">
                  {changes.length} edit{changes.length === 1 ? "" : "s"} this session
                </p>
              </div>
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", historyOpen && "rotate-180")}
                strokeWidth={2}
              />
            </button>
            {historyOpen && (
              <ol className="px-4 pb-3">
                {[...changes].reverse().map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
                    <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <p className="min-w-0 flex-1 text-sm text-foreground">{e.label}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}

        {/* 活动时间线(来源 / 导入 / 回复 / 报价 / 任务汇成一条流) */}
        {timeline.length > 0 && (
          <Card>
            <CardHeader title="Activity" desc="Where this contact came from and everything since" />
            <ol className="px-4 pb-3">
              {[...timeline].reverse().map((e) => (
                <li key={e.at} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Inbox className="size-4 text-muted-foreground" strokeWidth={2} />
                  </span>
                  <p className="min-w-0 flex-1 text-sm text-foreground">{e.label}</p>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Conversations"
            desc={conversations.length ? `${conversations.length} thread${conversations.length > 1 ? "s" : ""} with ${contact.name.split(" ")[0]}` : undefined}
          />
          {conversations.length > 0 ? (
            conversations.map((cv) => {
              const last = cv.messages[cv.messages.length - 1];
              return (
                <Link
                  key={cv.id}
                  href={`${BASE}/inbox/conversation?id=${cv.id}`}
                  className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-accent"
                >
                  <ChannelTag channel={cv.channel} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{cv.subject}</p>
                      {cv.unread && <Badge variant="warning">Unread</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{last?.text}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
                </Link>
              );
            })
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <MessageSquare className="size-5 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No conversations yet.</p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Deals"
            desc={deals.length ? `${deals.length} order${deals.length > 1 ? "s" : ""} tracked` : undefined}
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href={`${BASE}/crm/deals`}>
                  All deals
                  <ArrowRight strokeWidth={2} />
                </Link>
              </Button>
            }
          />
          {deals.length > 0 ? (
            deals.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{d.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Updated {fmtDate(d.updatedAt)}</p>
                </div>
                <StageBadge stage={d.stage} />
                <p className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{fmtMyr(d.amountMyr)}</p>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Receipt className="size-5 text-muted-foreground" strokeWidth={2} />
              <p className="text-sm text-muted-foreground">No deals yet.</p>
            </div>
          )}
        </Card>
      </div>

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        primary={contact}
        candidates={mergeCandidatesView(contact.id)}
      />
      <QuoteDialog open={quoteOpen} onOpenChange={setQuoteOpen} contactId={contact.id} />
    </div>
  );
}

/* ── 自定义字段卡 ─────────────────────────────────────────────────────────── */
const FIELD_TYPES: { id: NsCustomFieldType; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "select", label: "Choice" },
];

function CustomFieldsCard({
  contactId,
  fields,
}: {
  contactId: string;
  fields: { id: string; label: string; type: NsCustomFieldType; value: string }[];
}) {
  const [adding, setAdding] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState<NsCustomFieldType>("text");
  const [value, setValue] = React.useState("");

  const save = () => {
    if (!label.trim()) return;
    addContactField(contactId, label, type, value);
    setLabel("");
    setValue("");
    setType("text");
    setAdding(false);
  };

  return (
    <Card>
      <CardHeader
        title="Custom fields"
        desc="Track whatever matters for your trade — a due date, a preference, a size."
        action={
          !adding && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Plus strokeWidth={2} />
              Add field
            </Button>
          )
        }
      />
      {fields.map((f) => (
        <div key={f.id} className="flex items-center gap-3 border-t border-border px-4 py-3">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{f.label}</p>
            <p className="truncate text-xs text-muted-foreground">{f.value || "—"}</p>
          </div>
          <Badge variant="outline">{f.type}</Badge>
          <button
            type="button"
            onClick={() => removeContactField(contactId, f.id)}
            aria-label={`Remove ${f.label}`}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      ))}
      {adding && (
        <div className="flex flex-col gap-3 border-t border-border bg-muted/40 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Field name (e.g. Policy renewal)" className="h-9 min-w-40 flex-1" autoFocus />
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" className="h-9 min-w-32 flex-1" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {FIELD_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  type === t.id ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {t.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" disabled={!label.trim()} onClick={save}>Add</Button>
            </div>
          </div>
        </div>
      )}
      {fields.length === 0 && !adding && (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          No custom fields yet. Need a whole record type like “equipment” or “courses”? That's coming.
        </p>
      )}
    </Card>
  );
}

/* ── 待办任务卡 ───────────────────────────────────────────────────────────── */
function TasksCard({
  contactId,
  todos,
  firstName,
}: {
  contactId: string;
  todos: { id: string; title: string; due: string; done: boolean }[];
  firstName: string;
}) {
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");

  const save = () => {
    if (!title.trim()) return;
    addContactTodo(contactId, title, due);
    setTitle("");
    setDue("");
    setAdding(false);
  };

  const open = todos.filter((t) => !t.done);

  return (
    <Card>
      <CardHeader
        title="Tasks"
        desc={open.length ? `${open.length} to do for ${firstName}` : "Set a reminder so nothing slips"}
        action={
          !adding && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Plus strokeWidth={2} />
              Add task
            </Button>
          )
        }
      />
      {todos.map((t) => (
        <div key={t.id} className="flex items-center gap-3 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => toggleContactTodo(t.id)}
            aria-label={t.done ? "Mark as not done" : "Mark as done"}
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
              t.done ? "border-transparent bg-primary text-primary-foreground" : "border-border hover:bg-accent",
            )}
          >
            {t.done && <Check className="size-3.5" strokeWidth={3} />}
          </button>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm text-foreground", t.done && "text-muted-foreground line-through")}>{t.title}</p>
            {t.due && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" strokeWidth={2} />
                Due {fmtDate(t.due)}
              </p>
            )}
          </div>
        </div>
      ))}
      {adding && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up about the wholesale order" className="h-9 min-w-40 flex-1" autoFocus />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 w-40" aria-label="Due date" />
          <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
          <Button size="sm" disabled={!title.trim()} onClick={save}>Add</Button>
        </div>
      )}
      {todos.length === 0 && !adding && (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">No tasks yet.</p>
      )}
    </Card>
  );
}

/* ── 报价单 + 收款链接卡 ──────────────────────────────────────────────────── */
function QuotesCard({
  quotes,
  onNew,
}: {
  quotes: { id: string; lines: NsQuoteLine[]; note: string; status: "sent" | "paid"; payLink: string }[];
  onNew: () => void;
}) {
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = (id: string, link: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(link);
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  return (
    <Card>
      <CardHeader
        title="Quotes & payment"
        desc="Build a quick quote and send a pay link straight to their WhatsApp."
        action={
          <Button variant="secondary" size="sm" onClick={onNew}>
            <CircleDollarSign strokeWidth={2} />
            New quote
          </Button>
        }
      />
      {quotes.length > 0 ? (
        quotes.map((q) => {
          const total = q.lines.reduce((s, l) => s + l.priceMyr * l.qty, 0);
          return (
            <div key={q.id} className="flex flex-col gap-2 border-t border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {q.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}
                </p>
                {q.status === "paid" ? <Badge variant="success">Paid</Badge> : <Badge variant="warning">Sent</Badge>}
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMyr(total)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-[8px] bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">{q.payLink}</span>
                <Button variant="ghost" size="sm" onClick={() => copy(q.id, q.payLink)}>
                  {copied === q.id ? <Check strokeWidth={2} /> : <Copy strokeWidth={2} />}
                  {copied === q.id ? "Copied" : "Copy link"}
                </Button>
                {q.status !== "paid" && (
                  <Button variant="secondary" size="sm" onClick={() => markQuotePaid(q.id)}>Mark paid</Button>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          No quotes yet. Money goes straight to your own account — FIKIRTIVE never touches it.
        </p>
      )}
    </Card>
  );
}

function QuoteDialog({
  open,
  onOpenChange,
  contactId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
}) {
  const products = React.useMemo(() => quoteProducts(), []);
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [note, setNote] = React.useState("");

  const lines: NsQuoteLine[] = products
    .filter((p) => (qty[p.id] ?? 0) > 0)
    .map((p) => ({ productId: p.id, name: p.name, qty: qty[p.id], priceMyr: p.priceMyr }));
  const total = lines.reduce((s, l) => s + l.priceMyr * l.qty, 0);

  const reset = () => {
    setQty({});
    setNote("");
  };
  const send = () => {
    if (lines.length === 0) return;
    createQuote({ contactId, lines, note });
    reset();
    onOpenChange(false);
  };
  const bump = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) + d) }));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>New quote</DialogTitle>
          <DialogDescription>
            Pick what they're buying. We total it and generate a pay link to your own account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[42vh] flex-col overflow-y-auto rounded-[14px] border border-border">
          {products.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-t border-border px-3 py-2.5 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                <p className="text-xs text-muted-foreground">{fmtMyr(p.priceMyr)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => bump(p.id, -1)} disabled={(qty[p.id] ?? 0) === 0} aria-label={`Fewer ${p.name}`}>−</Button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums text-foreground">{qty[p.id] ?? 0}</span>
                <Button variant="ghost" size="sm" onClick={() => bump(p.id, 1)} aria-label={`More ${p.name}`}>+</Button>
              </div>
            </div>
          ))}
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. pickup Friday 9am" />
        <DialogFooter className="flex-row items-center justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">Total {fmtMyr(total)}</span>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" disabled={lines.length === 0} onClick={send}>Send quote</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── 合并对话框(保留) ────────────────────────────────────────────────────── */
function MergeDialog({
  open,
  onOpenChange,
  primary,
  candidates,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  primary: NsContact;
  candidates: NsContact[];
}) {
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  const picked = candidates.find((c) => c.id === pickedId) ?? null;

  const close = () => {
    setPickedId(null);
    onOpenChange(false);
  };

  const confirm = () => {
    if (!picked) return;
    mergeContacts(primary.id, picked.id);
    close();
  };

  const mergedChannels = picked ? Array.from(new Set([...primary.channels, ...picked.channels])) : primary.channels;
  const mergedTags = picked ? Array.from(new Set([...primary.tags, ...picked.tags])) : primary.tags;
  const mergedOrders = picked ? primary.totalOrdersMyr + picked.totalOrdersMyr : primary.totalOrdersMyr;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-[min(620px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Merge duplicate contacts</DialogTitle>
          <DialogDescription>
            Same person on another channel? Pick the duplicate and we'll fold their channels, tags,
            conversations, and orders into <span className="font-semibold text-foreground">{primary.name}</span>.
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <div className="flex max-h-[46vh] flex-col overflow-y-auto rounded-[14px] border border-border">
            {candidates.length > 0 ? (
              candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPickedId(c.id)}
                  className="flex items-center gap-3 border-t border-border px-3 py-2.5 text-left first:border-t-0 hover:bg-accent"
                >
                  <ContactAvatar contact={c} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.channels.join(" · ")} · {fmtMyr(c.totalOrdersMyr)}
                    </p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                </button>
              ))
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No other contacts to merge with.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_1fr] gap-3">
              <ComparePane title="Keeping" name={primary.name} contact={primary} highlight />
              <ComparePane title="Folding in" name={picked.name} contact={picked} />
            </div>
            <div className="flex flex-col gap-1.5 rounded-[14px] border border-border bg-muted/40 p-3">
              <p className="text-xs font-semibold text-foreground">After merge</p>
              <p className="text-xs text-muted-foreground">
                {mergedChannels.length} channel{mergedChannels.length > 1 ? "s" : ""} ·{" "}
                {mergedTags.length} tag{mergedTags.length > 1 ? "s" : ""} · {fmtMyr(mergedOrders)} lifetime orders
              </p>
              <p className="text-xs text-muted-foreground">
                {picked.name}'s conversations move under {primary.name}. This is logged in the change history.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-3">
          {picked ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setPickedId(null)}>Back</Button>
              <Button size="sm" onClick={confirm}>Merge into {primary.name.split(" ")[0]}</Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComparePane({
  title,
  name,
  contact,
  highlight,
}: {
  title: string;
  name: string;
  contact: NsContact;
  highlight?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-[14px] border p-3", highlight ? "border-foreground/30 bg-card" : "border-border bg-card")}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      <p className="truncate text-sm font-semibold text-foreground">{name}</p>
      <p className="text-xs text-muted-foreground">{contact.channels.join(" · ")}</p>
      <p className="text-xs text-muted-foreground">{contact.tags.join(" · ") || "No tags"}</p>
      <p className="text-xs font-semibold tabular-nums text-foreground">{fmtMyr(contact.totalOrdersMyr)}</p>
    </div>
  );
}
