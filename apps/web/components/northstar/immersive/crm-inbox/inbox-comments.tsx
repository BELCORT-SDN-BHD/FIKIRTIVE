"use client";

/**
 * 评论 —— 社媒帖子下的公开评论,聚成一条待办流。每条带 Otto 建议回复,
 * 「采用」到输入并标记已回(§8a coral sweep 收尾)。派生自已发帖 NS_SCHEDULED_POSTS,
 * 不发明新数据。连到排期让「再发一条」有真去处。
 */

import * as React from "react";
import Link from "next/link";
import { MessageCircle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { CRM_INBOX_BASE as BASE, InboxNav, Card, fmtStamp, useSweep } from "./kit";
import { COMMENTS, type NsComment } from "./data";
import { ensureContactFromComment } from "../_store";

function CommentRow({ comment }: { comment: NsComment }) {
  const sweep = useSweep();
  const [replied, setReplied] = React.useState(comment.status === "replied");

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

      <div className="mt-2.5 flex items-center gap-2">
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
          }}
        >
          {replied ? "Replied" : "Post reply"}
        </Button>
      </div>
    </div>
  );
}

export function InboxComments() {
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
