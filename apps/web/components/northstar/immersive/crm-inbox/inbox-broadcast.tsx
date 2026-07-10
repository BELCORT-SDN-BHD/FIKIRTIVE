"use client";

/**
 * 群发 —— 节日促销一次发给一群客人,发不出去的自动重试,群发后客人回「要」自动接上跟进。
 *
 * [wave-b] 分群群发 + 失败重发 + 送达报表:选分群→选模板→发送,生成送达行,可一键重发失败。
 * [wave-b] 群发后关键词跟进:配一个关键词,回它的人自动进个性化 flow。
 * [wave-b] 老客唤醒预置模板:沉睡客户分群 + 唤回文案一键就位。
 * [wave-b] 冷启动号码导入直接群发:粘贴一批号码,不用等他们先来聊。
 * [wave-b] CTWA 成交回传 / 互动人群回流受众:最轻原型(说明卡 + 计数)。
 *
 * 血管:群发与重发写共享 store(sendBroadcast / resendFailed);受众计数读 contactsView()
 * (勿扰联系人自动排除,不计入人数),永不发明数据。
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Megaphone, RefreshCw, Send, Upload, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, InboxNav, Card, CardHeader } from "./kit";
import { contactMatchesRules, type NsSegment } from "./data";
// [wave-c-integration] 群发受众选择器改用 ALL_SEGMENTS(与 crm/segments 页同源):价值分离 +
// lifecycle + 通用内建。旧版只读基础 SEGMENTS,segments 页能看的价值/生命周期分群在这里选不到。
import { ALL_SEGMENTS } from "./crm-data";
import { useQueryParam } from "../_kit";
import type { NsContact } from "@/components/northstar/_mock";
import { WABA_TEMPLATES, parseImportedNumbers } from "./lifecycle-data";
import {
  useStore,
  contactsView,
  customSegments,
  broadcastsView,
  sendBroadcast,
  resendFailed,
  type NsBroadcastRun,
} from "../_store";

/** 一个分群当前可群发人数(排除勿扰;与 crm 分群同口径)。 */
function reachable(match: (c: NsContact) => boolean): number {
  return contactsView().filter((c) => match(c) && !c.doNotDisturb).length;
}

function BroadcastRow({ run }: { run: NsBroadcastRun }) {
  const delivered = run.total - run.failed;
  return (
    <div className="border-t border-border px-4 py-3.5 first:border-t-0">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{run.templateName}</p>
        <span className="text-[11px] text-muted-foreground">{run.at}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">To {run.segmentName} · {run.total} people</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="success">
          <Check strokeWidth={2} />
          {delivered} delivered
        </Badge>
        {run.failed > 0 ? (
          <Badge variant="warning">
            <AlertTriangle strokeWidth={2} />
            {run.failed} failed
          </Badge>
        ) : run.resent > 0 ? (
          <Badge variant="outline">{run.resent} resent</Badge>
        ) : null}
        {run.followUpKeyword && <Badge variant="outline">Follow-up: “{run.followUpKeyword}”</Badge>}
        <div className="flex-1" />
        {run.failed > 0 && (
          <Button size="sm" variant="secondary" onClick={() => resendFailed(run.id)}>
            <RefreshCw strokeWidth={2} />
            Resend failed
          </Button>
        )}
      </div>
    </div>
  );
}

export function InboxBroadcast() {
  useStore();
  const custom = customSegments();
  const runs = broadcastsView();

  // 内建 + 自建分群,统一成 {id,name,count,match} 供选择器
  const segmentOptions = React.useMemo(() => {
    const built = ALL_SEGMENTS.map((s: NsSegment) => ({ id: s.id, name: s.name, count: reachable(s.match) }));
    const own = custom.map((s) => ({
      id: s.id,
      name: s.name,
      count: contactsView().filter((c) => !c.doNotDisturb && contactMatchesRules(c, s.rules)).length,
    }));
    return [...built, ...own];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custom, runs]);

  // [wave-c-integration] 接住 crm/segments「Broadcast to this group」深链:?segment=<id> 预选该分群。
  // 旧版完全不读此参数 —— 从分群页点「群发到本群」落地后默认选中第一项,静默丢了老板的意图。
  const querySegment = useQueryParam("segment");
  const [segId, setSegId] = React.useState(querySegment ?? segmentOptions[0]?.id ?? "");
  React.useEffect(() => {
    if (querySegment) setSegId(querySegment);
  }, [querySegment]);
  const [templateId, setTemplateId] = React.useState(WABA_TEMPLATES.find((t) => t.category === "Marketing")?.id ?? WABA_TEMPLATES[0].id);
  const [followUp, setFollowUp] = React.useState("");
  const [importRaw, setImportRaw] = React.useState("");

  // [gate4/H3] 解析:store-live 自建分群与内建同源于 segmentOptions;命不中即 undefined ——
  // 绝不回落 segmentOptions[0],否则深链带来的未知/已失效分群会把消息静默发给第一内建群。
  const seg = segmentOptions.find((s) => s.id === segId);
  // 深链 ?segment= 带来的分群解析不到(最常见:运行时自建分群 seg-live-* 刷新即失):
  // 不静默换靶,而是明确告知并禁用发送(seg=undefined → Send 按钮已自动 disabled)。点任一 chip 即恢复。
  const deepLinkUnresolved = !!querySegment && segId === querySegment && !seg;
  const template = WABA_TEMPLATES.find((t) => t.id === templateId) ?? WABA_TEMPLATES[0];
  const imported = parseImportedNumbers(importRaw);

  function fire(total: number, segmentName: string) {
    if (total <= 0) return;
    sendBroadcast({ templateName: template.name, segmentName, total, followUpKeyword: followUp.trim() || undefined });
  }

  const totalReached = runs.reduce((s, r) => s + (r.total - r.failed), 0);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Broadcast"
        subtitle="Send one message to a whole group. Otto retries anyone it can't reach."
        actions={<InboxNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Broadcasts sent" value={String(runs.length)} />
        <StatCard label="People reached" value={String(totalReached)} />
        <StatCard label="Segments" value={String(segmentOptions.length)} />
      </div>

      {/* 新群发编排 */}
      <Card className="mt-6 overflow-hidden">
        <CardHeader title="New broadcast" desc="Pick who, pick the message, send." />
        <div className="p-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Send to</p>
          <div className="flex flex-wrap gap-2">
            {segmentOptions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegId(s.id)}
                aria-current={segId === s.id ? "true" : undefined}
                className={
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
                  (segId === s.id ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                <Users className="size-3" strokeWidth={2} />
                {s.name}
                <span className="text-muted-foreground">· {s.count}</span>
              </button>
            ))}
          </div>

          {/* [gate4/H3] 深链分群解析失败:诚实告知 + 禁用发送,绝不静默发给第一内建群。 */}
          {deepLinkUnresolved && (
            <p role="alert" className="mt-2 flex items-center gap-1.5 rounded-[10px] border border-warning-soft-foreground/30 bg-warning-soft/50 px-3 py-2 text-xs font-medium text-warning-soft-foreground">
              <AlertTriangle className="size-3.5 shrink-0" strokeWidth={2} />
              That group isn’t available anymore — it may have been lost when the page refreshed. Pick a group above to continue.
            </p>
          )}

          <p className="mt-4 mb-2 text-xs font-semibold text-muted-foreground">Message template</p>
          <div className="flex flex-wrap gap-2">
            {WABA_TEMPLATES.filter((t) => t.category === "Marketing" || t.category === "Utility").map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                aria-current={templateId === t.id ? "true" : undefined}
                className={
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
                  (templateId === t.id ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                {t.name}
              </button>
            ))}
          </div>
          <p className="mt-2 rounded-[10px] bg-secondary/50 px-3 py-2 text-[13px] leading-[18px] text-muted-foreground">{template.body}</p>

          {/* [wave-b] 群发后关键词跟进 */}
          <div className="mt-4">
            <label htmlFor="followup" className="text-xs font-semibold text-muted-foreground">
              Auto follow-up keyword (optional)
            </label>
            <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">Anyone who replies with this word gets a personalised follow-up automatically.</p>
            <Input id="followup" value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="e.g. YES" className="h-9 max-w-[240px]" />
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-secondary/40 px-3 py-2.5">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              Sending to <span className="font-semibold text-foreground">{seg?.count ?? 0}</span> reachable people
              {" "}· do-not-disturb contacts are skipped
            </p>
            <Button size="sm" disabled={!seg || seg.count <= 0} onClick={() => seg && fire(seg.count, seg.name)}>
              <Send strokeWidth={2} />
              Send broadcast
            </Button>
          </div>
        </div>
      </Card>

      {/* [wave-b] 冷启动号码导入直接群发 */}
      <Card className="mt-6 overflow-hidden">
        <CardHeader title="Import a list" desc="Cold numbers — paste and broadcast without waiting for them to message first." />
        <div className="p-4">
          <Textarea
            value={importRaw}
            onChange={(e) => setImportRaw(e.target.value)}
            placeholder={"+60 12-345 6789\n+60 13-220 4471\n…"}
            className="min-h-[80px] resize-none font-mono text-[13px]"
          />
          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{imported.length} number{imported.length === 1 ? "" : "s"} detected</span>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" disabled={imported.length === 0} onClick={() => fire(imported.length, "Imported list")}>
              <Upload strokeWidth={2} />
              Broadcast to list
            </Button>
          </div>
        </div>
      </Card>

      {/* [wave-b] 老客唤醒 */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
            <Megaphone className="size-4 text-muted-foreground" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Wake up sleeping customers</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Otto lined up everyone quiet for 90+ days with a “we miss you” offer ready to go.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => fire(reachable((c) => (c.lifecycle ?? "") === "dormant"), "Sleeping customers")}>
            Send win-back
          </Button>
        </div>
      </Card>

      {/* 送达报表 */}
      {runs.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Delivery report</h2>
          <Card className="overflow-hidden">
            {runs.map((r) => (
              <BroadcastRow key={r.id} run={r} />
            ))}
          </Card>
        </div>
      )}

      {/* [wave-b] CTWA 成交回传 + 互动人群回流受众 —— 最轻原型 */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Closed-chat → ad platform" desc="CAPI / TikTok lower-funnel" />
          <div className="px-4 py-3.5 text-xs leading-5 text-muted-foreground">
            When a chat turns into a sale, Otto tells Meta &amp; TikTok — so your ads learn to find more people like your best buyers.
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Chatted, didn't buy → retargeting" desc="Custom audience sync" />
          <div className="px-4 py-3.5 text-xs leading-5 text-muted-foreground">
            People who messaged but haven't ordered flow into a “warm” ad audience automatically — no exporting spreadsheets.
          </div>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Build a group first in{" "}
        <Link href={`${BASE}/crm/segments`} className="font-semibold text-foreground hover:underline">
          Segments
        </Link>
        , then broadcast to it here.
      </p>
    </div>
  );
}
