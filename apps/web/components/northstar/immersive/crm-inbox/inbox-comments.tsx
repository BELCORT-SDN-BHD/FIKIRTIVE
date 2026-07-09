"use client";

/**
 * 评论 —— 社媒帖子下的公开评论,聚成一条待办流。每条带 Otto 建议回复,
 * 「采用」到输入并标记已回(§8a coral sweep 收尾)。派生自已发帖 NS_SCHEDULED_POSTS,
 * 不发明新数据。连到排期让「再发一条」有真去处。
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, AtSign, Heart, MessageCircle, Radio, Send, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, InboxNav, Card, CardHeader, fmtStamp, useSweep } from "./kit";
import { COMMENTS, type NsComment } from "./data";
import { COMMENT_HOOKS } from "./lifecycle-data";
import { useStore, askOttoInline, ensureContactFromComment, startDmFromComment, commentThreadFor, isCommentHookOn, toggleCommentHook } from "../_store";

const HOOK_ICON: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  comment: MessageCircle,
  story: AtSign,
  follow: Heart,
  live: Radio,
  share: Send,
};

/** [wave-b] 增长钩子:评论/Story/关注/直播 → 自动私信(Quick Automations 3 步预设,不进画布)。 */
function GrowthHooksCard() {
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title="Turn engagement into DMs" desc="Otto watches for these and starts a private chat automatically." />
      {COMMENT_HOOKS.map((h) => {
        const Icon = HOOK_ICON[h.event] ?? Zap;
        return (
          <div key={h.id} className="flex items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
              <Icon className="size-4 text-muted-foreground" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{h.label}</p>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{h.detail}</p>
            </div>
            <Switch checked={isCommentHookOn(h.id, h.defaultOn)} onCheckedChange={(on) => toggleCommentHook(h.id, on)} aria-label={h.label} />
          </div>
        );
      })}
      <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        Three-step presets — pick a post, pick a keyword, pick the reply. No flow builder to learn.
      </div>
    </Card>
  );
}

function CommentRow({ comment }: { comment: NsComment }) {
  const sweep = useSweep();
  const router = useRouter();
  const [replied, setReplied] = React.useState(comment.status === "replied");
  const dmThreadId = commentThreadFor(comment.id);

  return (
    <div className="border-t border-border px-4 py-3.5 first:border-t-0" style={sweep.style}>
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
          @
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">@{comment.author}</p>
            {replied ? <Badge variant="success">Replied</Badge> : <Badge variant="warning">New</Badge>}
            {dmThreadId && <Badge variant="outline">In DM</Badge>}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">on “{comment.postCaption}”</p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">{fmtStamp(comment.at)}</span>
      </div>

      <p className="mt-2 text-sm leading-5 text-foreground">{comment.text}</p>

      <div className="mt-2.5 rounded-[12px] bg-secondary/60 p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <Sparkles className="size-3" strokeWidth={2} />
          Otto suggests
        </div>
        <p className="mt-1 text-[13px] leading-[18px] text-foreground">{comment.suggested}</p>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          variant={replied ? "ghost" : "secondary"}
          size="sm"
          disabled={replied}
          onClick={() => {
            setReplied(true);
            sweep.fire();
            // 评论作者身份锚点:回复即把 @handle 补建成 CRM 联系人(缺则新建)
            ensureContactFromComment(
              comment.author,
              "instagram",
              comment.at.slice(0, 10),
              `Came in from a comment on “${comment.postCaption}”`,
            );
            // 就地 Otto 统一(O-12):Otto 对这条评论的建议进共享 dock/otto-chat 同一线程,
            // 不再是评论页各自的匿名小 AI。
            askOttoInline(
              `Draft a reply to @${comment.author}'s comment on “${comment.postCaption}”.`,
              comment.suggested,
              { view: "Comments", selectedLabel: `@${comment.author}` },
            );
          }}
        >
          {replied ? "Replied" : "Post reply"}
        </Button>

        {/* Comment-to-DM 增长钩:转成私信 → 生成 DM 草稿 → 进对话视图 */}
        {dmThreadId ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`${BASE}/inbox/conversation?id=${dmThreadId}`}>
              Open DM
              <ArrowRight strokeWidth={2} />
            </Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const cvId = startDmFromComment({
                commentId: comment.id,
                handle: comment.author,
                channel: "instagram",
                postCaption: comment.postCaption,
                commentText: comment.text,
                suggested: comment.suggested,
                at: comment.at,
              });
              router.push(`${BASE}/inbox/conversation?id=${cvId}`);
            }}
          >
            <Send strokeWidth={2} />
            Message in DM
          </Button>
        )}
      </div>
    </div>
  );
}

export function InboxComments() {
  useStore(); // 订阅:某评论转为 DM 后即刻显示「In DM / Open DM」
  const newCount = COMMENTS.filter((c) => c.status === "new").length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Comments"
        subtitle="Public comments on your posts. Otto drafts a reply for each."
        actions={<InboxNav />}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="Comments" value={String(COMMENTS.length)} />
        <StatCard label="Waiting on you" value={String(newCount)} />
      </div>

      <GrowthHooksCard />

      <Card className="mt-6 overflow-hidden">
        {COMMENTS.length > 0 ? (
          COMMENTS.map((c) => <CommentRow key={c.id} comment={c} />)
        ) : (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <MessageCircle className="size-5 text-muted-foreground" strokeWidth={2} />
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Comments come from posts you{" "}
        <Link href={`${BASE}/schedule/queue`} className="font-semibold text-foreground hover:underline">
          scheduled
        </Link>
        . Reply here or open the{" "}
        <Link href={`${BASE}/inbox/shared`} className="font-semibold text-foreground hover:underline">
          shared inbox
        </Link>{" "}
        for DMs.
      </p>
    </div>
  );
}
