"use client";

/**
 * 联系人 —— 客户名册(Z7 endgame)。整行 = 真去处(→ 档案)。头像全用 NS_IMAGES。
 *
 * WHATPASS 一章落点(每条 [wave-b]):
 *  · CSV 导入向导(贴表 → 映射 → 查重预览 → 确认)          [wave-b] CSV 导入向导
 *  · 查重合并提示(名册顶部「可能重复」→ 去档案合并)        [wave-b] 查重合并提示
 *  · Otto 热/温/冷标签 + 一句理由 + 一句 Otto 洞察          [wave-b] Otto 热度标签
 *  · 生命周期阶段 chip + 流失唤回条(dormant → 建跟进任务)   [wave-b] lifecycle+流失唤回
 *  · 预测字段(预计下次消费)作为列展示                     [wave-b] 预测字段标签
 *  · 进线来源标注 + 广告进线自动建档(来源写在行上)        [wave-b] 进线自动建档+来源标注
 *  · B2B 公司轻量档案(名册底部公司卡)                     [wave-b] B2B 公司轻量档案
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Check,
  Copy,
  GitMerge,
  Search,
  Sparkles,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
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
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, ChannelTag, CrmNav, Card, CardHeader, fmtDate, fmtMyr, type NsInboxChannel } from "./kit";
import { ContactAvatar, HeatBadge, LifecycleBadge, heatReason } from "./crm-kit";
import {
  COMPANIES,
  companyOrdersMyr,
  duplicatePairs,
  findDuplicate,
  parseCsv,
  predictedNext,
  atRiskSummary,
  winBackList,
  winBackWhy,
  winBackDraft,
  QUIET_THRESHOLD_DAYS,
  SAMPLE_CSV,
} from "./crm-data";
import {
  useStore,
  contactsView,
  isInboxContact,
  importContacts,
  captureLeadContact,
  addContactTodo,
} from "../_store";
import type { NsContact, NsHeat } from "@/components/northstar/_mock";

type HeatFilter = "all" | NsHeat;

/* ── [wave-c] 唤回行:为什么现在 + 预填草稿(可复制) + 一条具体待办 ─────────────────
 * 草稿金额/节律全从字段拼(winBackDraft),店主改一句就发。「Add follow-up」建的是有内容的
 * 待办(具体动作),不再是空白「Win back X」。发/花永不自动触发 —— 只帮起草,店主亲手发。 */
function WinBackRow({ contact: c }: { contact: NsContact }) {
  const [copied, setCopied] = React.useState(false);
  const draft = winBackDraft(c);
  const first = c.name.replace(/^@/, "").split(/\s+/)[0];

  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(draft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <ContactAvatar contact={c} className="size-8" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={`${BASE}/crm/contact-profile?id=${c.id}`} className="truncate text-sm font-semibold text-foreground hover:underline">
              {c.name}
            </Link>
            {c.doNotDisturb && <Badge variant="outline">Do not disturb</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">{winBackWhy(c)}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-error-soft-foreground">{fmtMyr(c.totalOrdersMyr)}</span>
      </div>
      {/* 预填草稿:真字段拼成,可复制;发仍要店主亲手点(Apply/复制不发) */}
      <div className="flex items-start gap-2 rounded-[10px] border border-border bg-muted/40 px-3 py-2">
        <p className="min-w-0 flex-1 text-xs leading-5 text-foreground">{draft}</p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={copy}>
          {copied ? <Check strokeWidth={2} /> : <Copy strokeWidth={2} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => addContactTodo(c.id, `Win back ${first} — send the ${fmtMyr(c.totalOrdersMyr)} account a nudge`, "")}
        >
          Add follow-up
        </Button>
      </div>
    </div>
  );
}

function ContactRow({ contact }: { contact: NsContact }) {
  return (
    <Link
      href={`${BASE}/crm/contact-profile?id=${contact.id}`}
      className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-accent"
    >
      <ContactAvatar contact={contact} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-foreground">{contact.name}</p>
          {isInboxContact(contact.id) && <Badge variant="warning">New</Badge>}
          {contact.doNotDisturb && <Badge variant="outline">Do not disturb</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span title={heatReason(contact)}>
            <HeatBadge heat={contact.heat} />
          </span>
          <LifecycleBadge stage={contact.lifecycle} />
          {contact.source && (
            <span className="truncate text-[11px] text-muted-foreground">· {contact.source}</span>
          )}
        </div>
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        {contact.channels.map((c) => (
          <ChannelTag key={c} channel={c as NsInboxChannel} />
        ))}
      </div>
      <div className="w-28 shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-foreground">{fmtMyr(contact.totalOrdersMyr)}</p>
        {(() => {
          const p = predictedNext(contact);
          return p.amountMyr > 0 ? (
            <p className="text-[11px] text-muted-foreground">Next ~{fmtMyr(p.amountMyr)}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Seen {fmtDate(contact.lastSeen)}</p>
          );
        })()}
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
    </Link>
  );
}

export function CrmContacts() {
  const [query, setQuery] = React.useState("");
  const [heat, setHeat] = React.useState<HeatFilter>("all");
  const [importOpen, setImportOpen] = React.useState(false);
  const [leadOpen, setLeadOpen] = React.useState(false);
  useStore(); // 订阅共享 store:导入 / 进线 / 唤回任务即刻反映
  const contacts = contactsView();

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (heat !== "all" && c.heat !== heat) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        (c.source ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, contacts, heat]);

  const totalLtv = contacts.reduce((sum, c) => sum + c.totalOrdersMyr, 0);
  const hotCount = contacts.filter((c) => c.heat === "hot").length;
  // [wave-c] 唤回名单按在险金额降序(winBackScore),不再按 lifecycle 硬标 slice(0,3)。
  const winBack = winBackList(contacts);
  const atRisk = atRiskSummary(contacts);
  const dupPairs = duplicatePairs(contacts);

  const heatChips: { id: HeatFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "hot", label: "Hot" },
    { id: "warm", label: "Warm" },
    { id: "cold", label: "Cold" },
  ];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Contacts"
        subtitle="Everyone who's messaged or ordered. Tap a row to open their profile."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setLeadOpen(true)}>
              <UserPlus strokeWidth={2} />
              Add lead
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload strokeWidth={2} />
              Import
            </Button>
            <CrmNav />
          </div>
        }
      />

      {/* §D3 四张数据卡 */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Contacts" value={String(contacts.length)} />
        <StatCard label="Lifetime orders" value={fmtMyr(totalLtv)} />
        <StatCard label="Hot right now" value={String(hotCount)} />
        <StatCard
          label="At risk"
          value={atRisk.count > 0 ? fmtMyr(atRisk.totalMyr) : "—"}
          delta={
            atRisk.count > 0
              ? { dir: "down", text: `${atRisk.count} quiet · ${atRisk.pctOfBook}% of book` }
              : undefined
          }
        />
      </div>

      {/* Otto 洞察条(CRM 唯一 coral 触点:一句人话,不是数字打分) */}
      {hotCount > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
          <OttoAvatar size={22} mood="helpful" />
          <p className="min-w-0 flex-1 text-sm leading-5 text-foreground">
            <span className="font-semibold">{hotCount} contact{hotCount === 1 ? "" : "s"} look hot.</span>{" "}
            They messaged or ordered in the last few days — reply while you're top of mind.
          </p>
        </div>
      )}

      {/* 查重合并提示 */}
      {dupPairs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[14px] border border-warning-soft bg-warning-soft/50 px-4 py-3">
          <GitMerge className="size-4 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
          <p className="min-w-0 flex-1 text-sm text-foreground">
            {dupPairs.length} possible duplicate{dupPairs.length === 1 ? "" : "s"} — same name on your list.
          </p>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`${BASE}/crm/contact-profile?id=${dupPairs[0].a.id}`}>Review {dupPairs[0].a.name.split(" ")[0]}</Link>
          </Button>
        </div>
      )}

      {/* 流失唤回条 —— [wave-c] 按在险金额排 + 硬钱数卡头 + 预填草稿(治 ledger gap#3/#4) */}
      {winBack.length > 0 && (
        <Card className="mt-3 overflow-hidden">
          <CardHeader
            title="Needs a win-back"
            desc={`${winBack.length} quiet · ${fmtMyr(atRisk.totalMyr)} at risk (${atRisk.pctOfBook}% of your book). Biggest at-risk first. Quiet line: ~${QUIET_THRESHOLD_DAYS} days (bakery default — Otto tightens it per account).`}
          />
          {winBack.slice(0, 3).map((c) => (
            <WinBackRow key={c.id} contact={c} />
          ))}
          {winBack.length > 3 && (
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              +{winBack.length - 3} more quiet, smaller accounts below the fold.
            </p>
          )}
        </Card>
      )}

      {/* 名册 */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, tag or source"
            className="h-9 min-w-32 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-1">
            {heatChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setHeat(chip.id)}
                aria-pressed={heat === chip.id}
                className={cn(
                  // §5a 手感:可点 chip 用 ns-pressable;§2 双声部:选中 = 人手动作 → 低调蓝
                  "ns-pressable rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  heat === chip.id ? "ns-human-soft" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{filtered.length} shown</span>
        </div>
        {filtered.length > 0 ? (
          filtered.map((c) => <ContactRow key={c.id} contact={c} />)
        ) : (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-[14px] bg-secondary">
              <Users className="size-5 text-muted-foreground" strokeWidth={2} />
            </span>
            <p className="text-sm font-semibold text-foreground">No contacts match</p>
            <p className="text-xs text-muted-foreground">Try a different name, tag or heat.</p>
          </div>
        )}
      </Card>

      {/* B2B 公司轻量档案 */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Companies" desc="Group buyers who order under one business" />
        {COMPANIES.map((co) => {
          const people = co.contactIds.map((id) => contacts.find((c) => c.id === id)).filter(Boolean) as NsContact[];
          return (
            <Link
              key={co.id}
              href={`${BASE}/crm/contact-profile?id=${co.contactIds[0]}`}
              className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-accent"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
                <Building2 className="size-4 text-muted-foreground" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{co.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {co.industry} · {people.length} contact{people.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMyr(companyOrdersMyr(co))}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
            </Link>
          );
        })}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Group contacts into{" "}
        <Link href={`${BASE}/crm/segments`} className="ns-human-text font-semibold hover:underline">segments</Link>{" "}
        or track orders in{" "}
        <Link href={`${BASE}/crm/deals`} className="ns-human-text font-semibold hover:underline">deals</Link>.
      </p>

      <ImportWizard open={importOpen} onOpenChange={setImportOpen} existing={contacts} />
      <AddLeadDialog open={leadOpen} onOpenChange={setLeadOpen} />
    </div>
  );
}

/* ── CSV 导入向导:贴表 → 映射 → 查重预览 → 确认 ───────────────────────────── */
function ImportWizard({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: NsContact[];
}) {
  const [step, setStep] = React.useState<0 | 1 | 2>(0);
  const [raw, setRaw] = React.useState("");
  const [result, setResult] = React.useState<{ added: number; skipped: number } | null>(null);

  const rows = React.useMemo(() => parseCsv(raw), [raw]);
  const flagged = React.useMemo(
    () => rows.map((r) => ({ row: r, dup: findDuplicate(r.name, existing) })),
    [rows, existing],
  );
  const dupCount = flagged.filter((f) => f.dup).length;

  const reset = () => {
    setStep(0);
    setRaw("");
    setResult(null);
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };

  const confirm = () => {
    const res = importContacts(rows.map((r) => ({ ...r, source: "Imported list" })));
    setResult(res);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-[min(640px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            Bring years of customers in at once. Paste your spreadsheet — we map the columns and flag
            anyone who looks like a duplicate before saving.
          </DialogDescription>
        </DialogHeader>

        {/* 步骤指示 */}
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          {["Paste", "Map", "Preview"].map((label, i) => (
            <span
              key={label}
              className={cn(
                "rounded-full px-2.5 py-1",
                i === step ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"name,phone,channel,tags\nAisha Lim,+60 12-345 6789,whatsapp,new"}
              className="min-h-36 rounded-[14px] bg-card font-mono text-[13px] leading-5"
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setRaw(SAMPLE_CSV)}
                className="text-xs font-semibold text-foreground hover:underline"
              >
                Use a sample file
              </button>
              <span className="text-xs text-muted-foreground">{rows.length} row{rows.length === 1 ? "" : "s"} detected</span>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold text-foreground">Column mapping</p>
            {[
              ["Name", "name"],
              ["Phone", "phone"],
              ["Channel", "channel"],
              ["Tags", "tags"],
            ].map(([label, col]) => (
              <div key={col} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{col}</span>
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <ArrowRight className="size-3.5 text-muted-foreground" strokeWidth={2} />
                  {label}
                </span>
              </div>
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              Matched by header row. Unknown channels default to WhatsApp.
            </p>
          </div>
        )}

        {step === 2 && !result && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{rows.length} to import</span>
              {dupCount > 0 && (
                <span className="font-semibold text-warning-soft-foreground">{dupCount} possible duplicate{dupCount === 1 ? "" : "s"}</span>
              )}
            </div>
            <div className="flex max-h-[40vh] flex-col overflow-y-auto rounded-[14px] border border-border">
              {flagged.map((f, i) => (
                <div key={i} className="flex items-center gap-3 border-t border-border px-3 py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{f.row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.row.channel} · {f.row.phone || "no phone"}
                    </p>
                  </div>
                  {f.dup ? <Badge variant="warning">Possible duplicate</Badge> : <Badge variant="success">New</Badge>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Duplicates are skipped on save — open the existing contact to merge instead.
            </p>
          </div>
        )}

        {result && (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-border bg-muted/40 py-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-success-soft">
              <Sparkles className="size-5 text-success-soft-foreground" strokeWidth={2} />
            </span>
            <p className="text-sm font-semibold text-foreground">
              Added {result.added} contact{result.added === 1 ? "" : "s"}
            </p>
            {result.skipped > 0 && (
              <p className="text-xs text-muted-foreground">Skipped {result.skipped} possible duplicate{result.skipped === 1 ? "" : "s"}</p>
            )}
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-3">
          {result ? (
            <Button size="sm" onClick={close}>Done</Button>
          ) : step === 0 ? (
            <>
              <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
              <Button size="sm" disabled={rows.length === 0} onClick={() => setStep(1)}>Next</Button>
            </>
          ) : step === 1 ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setStep(0)}>Back</Button>
              <Button size="sm" onClick={() => setStep(2)}>Next</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>Back</Button>
              <Button size="sm" onClick={confirm}>Import {rows.length}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── 进线自动建档:一条来源明确的新客户当场落进名册(演示广告/表单进线) ──────── */
function AddLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = React.useState("");
  const [channel, setChannel] = React.useState<NsContact["channels"][number]>("whatsapp");
  const [source, setSource] = React.useState("Instagram · Merdeka week bakes");

  const reset = () => {
    setName("");
    setChannel("whatsapp");
    setSource("Instagram · Merdeka week bakes");
  };
  const save = () => {
    if (!name.trim()) return;
    captureLeadContact({ name, channel, source });
    reset();
    onOpenChange(false);
  };

  const channels: NsContact["channels"][number][] = ["whatsapp", "instagram", "facebook"];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-[min(460px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Add a lead</DialogTitle>
          <DialogDescription>
            When someone taps an ad or fills a form, they land here automatically — with the source
            noted. Add one by hand to see how it works.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New customer" autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-foreground">Came in on</span>
            <div className="flex gap-1.5">
              {channels.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors",
                    channel === ch ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-foreground">Source</span>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Which ad or form" />
          </div>
        </div>
        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!name.trim()} onClick={save}>Add lead</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
