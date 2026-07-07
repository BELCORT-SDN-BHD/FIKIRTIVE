/* @nsPage district="团队协作区" page="approvals" status="draft"
   sources="G-11 判决;P3-3;harmony-01 §四④" approvedAt="" pr="" */
"use client";

/**
 * 审批工作台 — 「小编做 → 老板批 → 才发布」的批阅面(founder 硬要求非常丝滑)。
 * 清单要件:待批队列(ApprovalRequest 统一原语)、payload 预览、批 / 驳 / 评论交接、
 *           hash 绑定失效提示。
 *
 * harmony-01 §四④:审批是一个原语、两个表面。ApprovalRequest 带 payload hash,
 *   审批后内容漂移即失效(G7 已验证模式)—— stale 请求要重审,不能直接批。
 *
 * Otto 在场:审批面按设计就是「approval-heavy」(§O3 Campaign/Schedule 一族)——
 *   队列头一个 Otto 陈述位;批一条 SPEND = 花真钱,按 §V5/§FB6:
 *   动作按钮带确切 credits,confirm 前把金额写进 impacts;coral 永不上色危险本身。
 * 布局:List archetype 的 list+detail(§L2);≤1000 折成单列(先列表后详情)。
 */

import * as React from "react";
import { Check, CircleAlert, MessageSquare, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  DemoStates,
  InitialsAvatar,
  InlineError,
  Landed,
  SkeletonBlock,
  type DemoState,
} from "@/components/northstar/team/_bits";
import {
  APPROVAL_KIND_META,
  APPROVAL_REQUESTS,
  APPROVALS_LAND_STEPS,
  type ApprovalKind,
  type ApprovalRequest,
  type ApprovalStatus,
} from "@/components/northstar/team/_data";

const KIND_BADGE: Record<ApprovalKind, "default" | "soft" | "warning" | "outline"> = {
  PUBLISH: "default",
  SPEND: "soft",
  AD_LAUNCH: "warning",
  CONTENT: "outline",
};

function StatusBadge({ status, stale }: { status: ApprovalStatus; stale?: boolean }) {
  if (stale) return <Badge variant="warning">Needs another look</Badge>;
  if (status === "approved") return <Badge variant="success">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Sent back</Badge>;
  return <Badge variant="outline">Waiting</Badge>;
}

function QueueItem({
  req,
  active,
  onSelect,
}: {
  req: ApprovalRequest;
  active: boolean;
  onSelect: () => void;
}) {
  const pending = req.status === "pending";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-[120ms]",
        active ? "bg-secondary" : "hover:bg-accent",
      )}
    >
      <div className="flex items-center gap-2">
        <Badge variant={KIND_BADGE[req.kind]} className="shrink-0">
          {APPROVAL_KIND_META[req.kind].label}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{req.title}</span>
        {pending && !req.stale && (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
        )}
        {req.stale && <CircleAlert className="size-3.5 shrink-0 text-warning-soft-foreground" strokeWidth={2} />}
      </div>
      <div className="flex items-center gap-1.5">
        <InitialsAvatar initials={req.requestedBy.initials} size={16} />
        <span className="truncate text-xs text-muted-foreground">
          {req.requestedBy.name} · {req.requestedAt}
        </span>
        {req.spendCredits != null && (
          <span className="ml-auto shrink-0 font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
            {req.spendCredits} cr
          </span>
        )}
      </div>
    </button>
  );
}

/* ── payload 预览(§D1 provenance;媒体占位纯示意,不外链) ── */
function PayloadPreview({ req }: { req: ApprovalRequest }) {
  const p = req.preview;
  return (
    <div className="rounded-[14px] border border-border bg-background/60 p-4">
      <div className="flex items-center gap-2 pb-3">
        <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          What gets sent
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          id {req.payloadHash}
        </span>
      </div>

      {p.media && (
        <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2">
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="text-xs text-muted-foreground">{p.media}</span>
        </div>
      )}

      {(p.channel || p.when) && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
          {p.channel && (
            <span className="text-xs text-muted-foreground">
              Channel · <span className="text-foreground">{p.channel}</span>
            </span>
          )}
          {p.when && (
            <span className="text-xs text-muted-foreground">
              When · <span className="text-foreground">{p.when}</span>
            </span>
          )}
        </div>
      )}

      {p.lines && (
        <dl className="mb-3 flex flex-col gap-1.5">
          {p.lines.map((l) => (
            <div key={l.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-xs text-muted-foreground">{l.label}</dt>
              <dd className="text-right text-[13px] font-medium text-foreground">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {p.caption && (
        <p className="rounded-[10px] bg-card p-3 text-[13px] leading-[20px] text-foreground">{p.caption}</p>
      )}
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  const [landed, setLanded] = React.useState(false);
  const [reqs, setReqs] = React.useState<ApprovalRequest[]>(() => APPROVAL_REQUESTS.map((r) => ({ ...r })));
  const [selectedId, setSelectedId] = React.useState<string>(APPROVAL_REQUESTS[0]!.id);
  const [comment, setComment] = React.useState("");
  const [confirm, setConfirm] = React.useState<null | { kind: "approve" | "reject"; id: string }>(null);

  const isLoading = demo === "loading";
  const isEmpty = demo === "empty";
  const isError = demo === "error";
  const show = landed && !isLoading && !isEmpty && !isError;

  const selected = reqs.find((r) => r.id === selectedId) ?? reqs[0] ?? null;
  const pendingCount = reqs.filter((r) => r.status === "pending").length;
  const staleCount = reqs.filter((r) => r.stale).length;

  function decide(id: string, decision: "approved" | "rejected") {
    setReqs((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: decision,
              stale: false,
              comments:
                comment.trim().length > 0
                  ? [...r.comments, { author: "Aisyah Rahman", initials: "AR", text: comment.trim(), at: "just now" }]
                  : r.comments,
            }
          : r,
      ),
    );
    setComment("");
    setConfirm(null);
  }

  const confirmReq = confirm ? reqs.find((r) => r.id === confirm.id) ?? null : null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Approvals"
        subtitle="Your team's work, waiting for your yes. Nothing goes out until you approve it."
        meta={pendingCount > 0 ? [`${pendingCount} waiting`] : undefined}
      />

      {/* 数据一行(§D3) */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Waiting for you" value={show ? String(pendingCount) : "—"} />
        <StatCard label="Needs another look" value={show ? String(staleCount) : "—"} delta={{ dir: "flat", text: "content changed" }} />
        <StatCard label="Approved today" value={show ? "1" : "—"} delta={{ dir: "up", text: "▲ on track" }} />
        <StatCard label="Sent back today" value={show ? "1" : "—"} delta={{ dir: "flat", text: "with a note" }} />
      </div>

      {/* Otto 陈述位(§O3 approval-heavy:队列头一句 Otto 的话;approving 一族) */}
      <div className="mt-6 flex items-start gap-3 rounded-[14px] border border-border bg-brand-soft/40 px-4 py-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft">
          <OttoAvatar size={22} mood="waiting" />
        </span>
        <p className="text-[13px] leading-[19px] text-foreground">
          {show && pendingCount > 0
            ? `You have ${pendingCount} things to look at. I've checked each one still matches what your team sent. One was edited after, so it needs a fresh look.`
            : "Nothing's waiting right now. I'll bring things here the moment your team sends work for approval."}
        </p>
      </div>

      {/* 工具行:叙述条 */}
      <div className="mt-6 flex items-center gap-3">
        <p className="text-xs text-muted-foreground">Approving a spend uses credits. The cost is always on the button.</p>
        <div className="flex-1" />
        {!landed && !isEmpty && !isError && (
          <OttoNarrationBar key="landing" steps={APPROVALS_LAND_STEPS} stepMs={1100} onSettle={() => setLanded(true)} />
        )}
      </div>

      {/* 主体 */}
      <div className="mt-4">
        {isError ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-card">
            <InlineError text="Couldn't load the queue. Try again." onRetry={() => setDemo("default")} />
          </div>
        ) : isEmpty ? (
          <div className="flex rounded-[var(--radius-card)] border border-border bg-card">
            <EmptyState
              icon={ShieldCheck}
              title="All caught up"
              body="Nothing's waiting for your approval. Your team's work will land here when it's ready for you."
            />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            {/* 左:待批队列 */}
            <div className="rounded-[var(--radius-card)] border border-border bg-card p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  Queue
                </span>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{reqs.length}</span>
              </div>
              {!show ? (
                <div className="flex flex-col gap-1.5 p-1">
                  <SkeletonBlock className="h-14 w-full" />
                  <SkeletonBlock className="h-14 w-full" />
                  <SkeletonBlock className="h-14 w-full" shimmer={false} />
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {reqs.map((r, i) => (
                    <Landed key={r.id} delayMs={(i % 6) * 60}>
                      <QueueItem req={r} active={selected?.id === r.id} onSelect={() => setSelectedId(r.id)} />
                    </Landed>
                  ))}
                </div>
              )}
            </div>

            {/* 右:payload 预览 + 批/驳/评论 */}
            <div>
              {!show ? (
                <div className="rounded-[var(--radius-card)] border border-border bg-card p-6">
                  <SkeletonBlock className="h-6 w-56" />
                  <SkeletonBlock className="mt-4 h-24 w-full" shimmer={false} />
                </div>
              ) : selected ? (
                <Landed key={selected.id}>
                  <article className="rounded-[var(--radius-card)] border border-border bg-card">
                    {/* 头:kind + 标题 + who */}
                    <div className="flex flex-wrap items-start gap-3 border-b border-border p-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={KIND_BADGE[selected.kind]}>{APPROVAL_KIND_META[selected.kind].label}</Badge>
                          <h2 className="text-lg font-semibold text-foreground">{selected.title}</h2>
                          <StatusBadge status={selected.status} stale={selected.stale} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <InitialsAvatar initials={selected.requestedBy.initials} size={20} />
                          <span className="text-xs text-muted-foreground">
                            {selected.requestedBy.name} sent this {selected.requestedAt}
                          </span>
                        </div>
                      </div>
                      {selected.spendCredits != null && (
                        <div className="shrink-0 rounded-[10px] bg-secondary px-3 py-1.5 text-right">
                          <div className="font-mono text-[10px] leading-none tracking-[0.06em] text-muted-foreground uppercase">
                            Cost
                          </div>
                          <div className="mt-0.5 font-semibold tabular-nums text-foreground">
                            {selected.spendCredits} credits
                          </div>
                        </div>
                      )}
                    </div>

                    {/* hash 绑定失效提示(§四④:内容漂移即失效,需重审) */}
                    {selected.stale && selected.status === "pending" && (
                      <div className="flex items-start gap-3 border-b border-border bg-warning-soft/40 p-5">
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-foreground">This changed after it was sent</p>
                          <p className="mt-0.5 text-[13px] leading-[19px] text-muted-foreground">
                            The content was edited since your team asked for approval, so the old yes wouldn't match.
                            Take a fresh look, then approve or send it back.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* payload 预览 */}
                    <div className="p-5">
                      <PayloadPreview req={selected} />
                    </div>

                    {/* 评论交接线程(§四④ 同一份 ApprovalRequest 上的往返) */}
                    {selected.comments.length > 0 && (
                      <div className="border-t border-border px-5 py-4">
                        <div className="flex items-center gap-1.5 pb-3">
                          <MessageSquare className="size-3.5 text-muted-foreground" strokeWidth={2} />
                          <span className="font-mono text-[10px] leading-none font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                            Notes
                          </span>
                        </div>
                        <ul className="flex flex-col gap-3">
                          {selected.comments.map((c, i) => (
                            <li key={i} className="flex gap-2.5">
                              <InitialsAvatar initials={c.initials} size={26} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-[13px] font-semibold text-foreground">{c.author}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">{c.at}</span>
                                </div>
                                <p className="mt-0.5 text-[13px] leading-[19px] text-foreground">{c.text}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 动作行:批 / 驳 + 评论框(pending 才出) */}
                    {selected.status === "pending" ? (
                      <div className="border-t border-border p-5">
                        <label htmlFor="approval-note" className="text-[13px] leading-[18px] font-semibold text-foreground">
                          Add a note {" "}
                          <span className="font-normal text-muted-foreground">(optional)</span>
                        </label>
                        <Textarea
                          id="approval-note"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="Send it back with a reason, or leave a note as you approve."
                          className="mt-2"
                          rows={2}
                        />
                        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirm({ kind: "reject", id: selected.id })}
                            className="text-error-soft-foreground hover:bg-error-soft hover:text-error-soft-foreground"
                          >
                            <RotateCcw strokeWidth={2} />
                            Send back
                          </Button>
                          <Button size="sm" onClick={() => setConfirm({ kind: "approve", id: selected.id })}>
                            <Check strokeWidth={2} />
                            {selected.spendCredits != null
                              ? `Approve · ${selected.spendCredits} credits`
                              : "Approve"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 border-t border-border px-5 py-4 text-[13px] text-muted-foreground">
                        {selected.status === "approved" ? (
                          <>
                            <Check className="size-4 text-success-soft-foreground" strokeWidth={2} />
                            You approved this.
                            {selected.spendCredits != null && ` It used ${selected.spendCredits} credits.`}
                          </>
                        ) : (
                          <>
                            <RotateCcw className="size-4 text-muted-foreground" strokeWidth={2} />
                            You sent this back to your team.
                          </>
                        )}
                      </div>
                    )}
                  </article>
                </Landed>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* 批 / 驳 confirm(§FB5/§FB6:approve SPEND = 真花钱,金额写进 impacts) */}
      <Dialog open={confirm != null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
          {confirm && confirmReq && (
            <>
              <div className="flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-brand-soft">
                  <OttoAvatar size={34} mood={confirm.kind === "approve" ? "approving" : "warning"} />
                </span>
                <DialogHeader className="space-y-1 text-left">
                  <DialogTitle>
                    {confirm.kind === "approve" ? "Approve this?" : "Send this back?"}
                  </DialogTitle>
                  <DialogDescription>{confirmReq.title}</DialogDescription>
                </DialogHeader>
              </div>
              <div className="mt-4 rounded-[14px] bg-secondary/70 p-4">
                <p className="text-[13px] font-semibold text-foreground">What happens</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {(confirm.kind === "approve"
                    ? [
                        confirmReq.kind === "PUBLISH"
                          ? "The post goes out at its scheduled time."
                          : confirmReq.kind === "AD_LAUNCH"
                            ? "The ad goes live and starts spending its daily cap."
                            : "Otto starts the work your team set up.",
                        confirmReq.spendCredits != null
                          ? `This spends ${confirmReq.spendCredits} credits now.`
                          : "No credits are spent by approving.",
                        "Your team sees your yes, and any note you left.",
                      ]
                    : [
                        "The work goes back to your team, not out.",
                        "Your note tells them what to change.",
                        "No credits are spent.",
                      ]
                  ).map((t) => (
                    <li key={t} className="flex gap-2 text-[13px] leading-[19px] text-muted-foreground">
                      <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <DialogFooter className="mt-6">
                <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                {confirm.kind === "approve" ? (
                  <Button size="sm" onClick={() => decide(confirm.id, "approved")}>
                    <Check strokeWidth={2} />
                    {confirmReq.spendCredits != null ? `Approve · ${confirmReq.spendCredits} credits` : "Approve"}
                  </Button>
                ) : (
                  <Button variant="destructive" size="sm" onClick={() => decide(confirm.id, "rejected")}>
                    <RotateCcw strokeWidth={2} />
                    Send back
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/team/approvals" />
      <DemoStates
        value={demo}
        onChange={(s) => {
          setDemo(s);
          if (s === "default") setLanded(true);
          if (s === "loading") setLanded(false);
        }}
      />
    </div>
  );
}
