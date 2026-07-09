"use client";

/**
 * 客户档案 —— 一个客户的全貌。上半是身份 + 生涯价值,下半把他们的对话与成交
 * 连起来(profile → conversation、profile → deals)。?id= 选人,缺省取第一个。
 *
 * 判决核心补齐(harmony-01 #7/#13):
 * - 多渠道身份卡:把这个人在 WhatsApp/IG/评论上的锚点摊开,可「合并重复联系人」
 *   (选一条 → 字段对比 → 合并),命中「同一人的另一渠道」这个差异化卖点。
 * - consent / 勿扰:档案上的开关写 store,列表 badge + 群发/排期选择器读同一字段。
 * - 字段变更留痕:每次改标签 / 勿扰 / 合并都进「Change history」折叠区。
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  GitMerge,
  History,
  Inbox,
  MessageSquare,
  Plus,
  Receipt,
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
  Initials,
  type NsInboxChannel,
} from "./kit";
import { dealsForContact, DEAL_STAGES, contactIdentities } from "./data";
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
  useStore(); // 订阅共享 store:身份 / 对话 / 收件箱时间线 / 字段编辑即时反映
  const contacts = contactsView();
  const id = params.get("id") ?? contacts[0]?.id ?? "";
  const contact = contactByIdView(id) ?? contacts[0];

  const [addingTag, setAddingTag] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState("");
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  if (!contact) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
        <EmptyState title="Contact not found" body="This contact may have been removed." />
      </div>
    );
  }

  const conversations = conversationsForContactView(contact.id);
  const deals = dealsForContact(contact.id).map((d) => ({ ...d, stage: dealStageOf(d.id, d.stage) }));
  const delivered = deals.filter((d) => d.stage === "delivered").reduce((s, d) => s + d.amountMyr, 0);
  const timeline = contactEventsFor(contact.id);
  const changes = contactChangesFor(contact.id);
  const identities = contactIdentities(contact);

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
          <Button variant="secondary" size="sm" asChild>
            <Link href={`${BASE}/crm/contacts`}>
              <ArrowLeft strokeWidth={2} />
              All contacts
            </Link>
          </Button>
        }
      />

      <Card className="mt-6 p-5">
        <div className="flex items-start gap-4">
          <Initials name={contact.name} className="size-14 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-[-0.02em] text-foreground">{contact.name}</h2>
              {isInboxContact(contact.id) && <Badge variant="warning">New</Badge>}
              {contact.doNotDisturb && <Badge variant="outline">Do not disturb</Badge>}
            </div>

            {/* 可编辑标签(留痕):X 移除、+ 新增 */}
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

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Lifetime orders" value={fmtMyr(contact.totalOrdersMyr)} />
        <StatCard label="Delivered value" value={fmtMyr(delivered)} />
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
            <div
              key={idn.channel}
              className="flex items-center gap-3 border-t border-border px-4 py-3"
            >
              <ChannelTag channel={idn.channel as NsInboxChannel} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{idn.label}</p>
                <p className="truncate text-xs text-muted-foreground">{idn.handle}</p>
              </div>
              <Badge variant="outline">Linked</Badge>
            </div>
          ))}

          {/* consent / 勿扰开关(写 store;列表 badge + 群发选择器读同一字段) */}
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
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  historyOpen && "rotate-180",
                )}
                strokeWidth={2}
              />
            </button>
            {historyOpen && (
              <ol className="px-4 pb-3">
                {[...changes].reverse().map((e, i) => (
                  <li
                    key={`${e.at}-${i}`}
                    className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <p className="min-w-0 flex-1 text-sm text-foreground">{e.label}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}

        {timeline.length > 0 && (
          <Card>
            <CardHeader title="From the inbox" desc="Where this contact came from and what's happened since" />
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
    </div>
  );
}

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

  const mergedChannels = picked
    ? Array.from(new Set([...primary.channels, ...picked.channels]))
    : primary.channels;
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
                  <Initials name={c.name} className="size-9 text-xs" />
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
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No other contacts to merge with.
              </p>
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
              <Button variant="secondary" size="sm" onClick={() => setPickedId(null)}>
                Back
              </Button>
              <Button size="sm" onClick={confirm}>
                Merge into {primary.name.split(" ")[0]}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={close}>
              Cancel
            </Button>
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
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[14px] border p-3",
        highlight ? "border-foreground/30 bg-card" : "border-border bg-card",
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      <p className="truncate text-sm font-semibold text-foreground">{name}</p>
      <p className="text-xs text-muted-foreground">{contact.channels.join(" · ")}</p>
      <p className="text-xs text-muted-foreground">{contact.tags.join(" · ") || "No tags"}</p>
      <p className="text-xs font-semibold tabular-nums text-foreground">{fmtMyr(contact.totalOrdersMyr)}</p>
    </div>
  );
}
