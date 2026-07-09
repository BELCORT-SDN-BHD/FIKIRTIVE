"use client";

/**
 * 模板与话术 —— WhatsApp Business API 的预审模板库、聊天内互动表单(Flow)、
 * 快捷话术库(snippets/宏)、号码质量与发送节流,一处管好「主动联系客人」的物料。
 *
 * [wave-b] WABA 模板消息库 + 送审状态:每条模板带 category/language/送审态,草稿可「送审」。
 * [wave-b] WhatsApp Flow 表单:聊天内收资料的原生表单,可发布/收回。
 * [wave-b] 快捷话术库/宏:一键插入常用回复(对话页 composer 也读同一份)。
 * [wave-b] Template Pacing / 号码质量监控:防封号的节流与质量分。
 * [wave-b] WhatsApp Co-existence / 语音渠道:最轻原型(状态卡 + 说明),交 founder 走城判。
 *
 * 血管:送审态/发布态读写共享 store(templateStatusFor / submitTemplate / toggleFlowPublished)。
 */

import * as React from "react";
import Link from "next/link";
import { BadgeCheck, FileText, Layers, Send, ShieldCheck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, InboxNav, Card, CardHeader } from "./kit";
import { WABA_TEMPLATES, WA_FLOWS, SNIPPETS, NUMBER_QUALITY } from "./lifecycle-data";
import { useStore, templateStatusFor, submitTemplate, isFlowPublished, toggleFlowPublished } from "../_store";

type TStatus = "approved" | "pending" | "rejected" | "draft";

const STATUS_BADGE: Record<TStatus, { variant: "success" | "warning" | "outline" | "destructive"; label: string }> = {
  approved: { variant: "success", label: "Approved" },
  pending: { variant: "warning", label: "In review" },
  rejected: { variant: "destructive", label: "Rejected" },
  draft: { variant: "outline", label: "Draft" },
};

export function InboxTemplates() {
  useStore();

  const approvedCount = WABA_TEMPLATES.filter((t) => templateStatusFor(t.id, t.status) === "approved").length;
  const publishedFlows = WA_FLOWS.filter((f) => isFlowPublished(f.id, f.status === "published")).length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Templates & snippets"
        subtitle="Pre-approved messages, in-chat forms, and quick replies — everything Otto reaches for."
        actions={<InboxNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard label="Templates" value={String(WABA_TEMPLATES.length)} />
        <StatCard label="Approved" value={String(approvedCount)} />
        <StatCard label="Flows live" value={String(publishedFlows)} />
        <StatCard label="Snippets" value={String(SNIPPETS.length)} />
      </div>

      {/* [wave-b] 号码质量 / Template Pacing —— 防封号 */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
            <ShieldCheck className="size-4 text-muted-foreground" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Number quality</p>
              <Badge variant="success">
                <BadgeCheck strokeWidth={2} />
                {NUMBER_QUALITY.rating}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{NUMBER_QUALITY.tier}</p>
          </div>
        </div>
        <div className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">{NUMBER_QUALITY.note}</div>
      </Card>

      {/* [wave-b] WABA 模板消息库 + 送审状态 */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-foreground">Message templates</h2>
        </div>
        <Card className="overflow-hidden">
          {WABA_TEMPLATES.map((t) => {
            const status = templateStatusFor(t.id, t.status) as TStatus;
            const badge = STATUS_BADGE[status];
            return (
              <div key={t.id} className="border-t border-border px-4 py-3.5 first:border-t-0">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{t.name}</p>
                  <Badge variant="outline">{t.category}</Badge>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <p className="mt-1.5 rounded-[10px] bg-secondary/50 px-3 py-2 text-[13px] leading-[18px] text-muted-foreground">{t.body}</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">{t.language} · used {t.usedThisWeek}× this week</span>
                  <div className="flex-1" />
                  {status === "draft" && (
                    <Button size="sm" variant="secondary" onClick={() => submitTemplate(t.id)}>
                      <Send strokeWidth={2} />
                      Send for review
                    </Button>
                  )}
                  {status === "pending" && <span className="text-[11px] font-semibold text-muted-foreground">Otto submitted it to Meta</span>}
                </div>
              </div>
            );
          })}
        </Card>
      </div>

      {/* [wave-b] WhatsApp Flow 表单 */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Layers className="size-4 text-muted-foreground" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-foreground">In-chat forms (WhatsApp Flows)</h2>
        </div>
        <Card className="overflow-hidden">
          {WA_FLOWS.map((f) => {
            const published = isFlowPublished(f.id, f.status === "published");
            return (
              <div key={f.id} className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{f.name}</p>
                    {published ? <Badge variant="success">Live</Badge> : <Badge variant="outline">Draft</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{f.purpose}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {f.fields.map((field) => (
                      <span key={field} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">{field}</span>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {published ? "Live" : "Off"}
                  <Switch checked={published} onCheckedChange={(on) => toggleFlowPublished(f.id, on)} aria-label={`Publish ${f.name}`} />
                </label>
              </div>
            );
          })}
        </Card>
      </div>

      {/* [wave-b] 快捷话术库 / 宏 */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-foreground">Quick replies (snippets)</h2>
        </div>
        <Card className="overflow-hidden">
          {SNIPPETS.map((s) => (
            <div key={s.id} className="border-t border-border px-4 py-3 first:border-t-0">
              <div className="flex items-center gap-2">
                <code className="rounded-[6px] bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground">{s.shortcut}</code>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{s.title}</p>
                <Badge variant="outline">Used {s.usedThisWeek}×</Badge>
              </div>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{s.text}</p>
            </div>
          ))}
          <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
            Type a shortcut like <code className="font-mono">/hours</code> in any chat to drop the reply in.
          </div>
        </Card>
      </div>

      {/* [wave-b] WhatsApp Co-existence + 语音渠道 —— 最轻原型 */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Personal → API number" desc="Co-existence" />
          <div className="px-4 py-3.5 text-xs leading-5 text-muted-foreground">
            Moving from your personal WhatsApp to a Business API number? During the switch, messages land in both places so nothing is lost.
            <div className="mt-2"><Badge variant="outline">Not started</Badge></div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="WhatsApp calling" desc="Voice notes & calls" />
          <div className="px-4 py-3.5 text-xs leading-5 text-muted-foreground">
            When a customer calls on WhatsApp, Otto can log a transcript and summary into the thread — so a spoken promise never gets forgotten.
            <div className="mt-2"><Badge variant="outline">Preview</Badge></div>
          </div>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Templates use your WhatsApp balance, kept separate from credits.{" "}
        <Link href={`${BASE}/account/channel-wallet`} className="font-semibold text-foreground hover:underline">
          Manage WhatsApp balance
        </Link>
        .
      </p>
    </div>
  );
}
