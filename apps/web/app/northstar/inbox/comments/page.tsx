/* @nsPage district="收件箱客服区" page="comments" status="draft"
   sources="N (Buffer) 公开评论收件箱判决「要」;P2-4" approvedAt="" pr="" */
"use client";

/**
 * 公开评论收件箱 — 帖子下的公开评论统一收进一个箱子逐条回。
 * 清单元素:public-comment 线程类型(按帖子分组)· 未答筛选。
 * 与私信箱区分:这是公开可见的评论,回复也公开,所以口吻与操作都更轻(quick reply)。
 * 未答筛选把没回过的评论顶出来;逐条 reply 就地展开一个小 composer。
 * 三态齐全 · coral 只属于 Otto · 纯展示零后台。
 */

import * as React from "react";
import { CornerDownRight, MessageCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import {
  ChannelTag,
  ContactAvatar,
  ConversationRowsSkeleton,
  DemoStateBar,
  ErrorPanel,
  fmtWhen,
  type DemoState,
} from "@/components/northstar/inbox/kit";
import {
  IB_COMMENT_POSTS,
  IB_COMMENTS,
  type IbComment,
} from "@/components/northstar/inbox/mock-inbox";

type Filter = "unanswered" | "all";

function CommentRow({
  comment,
  onReply,
  reply,
}: {
  comment: IbComment;
  onReply: (id: string, text: string) => void;
  reply?: { text: string; day: string; time: string };
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const answered = !!reply;

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onReply(comment.id, t);
    setDraft("");
    setOpen(false);
  };

  return (
    <div className="border-t border-border py-3 first:border-t-0">
      <div className="flex items-start gap-3">
        <ContactAvatar initials={comment.initials} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-foreground">{comment.author}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{fmtWhen(comment.day, comment.time)}</span>
            {!answered && (
              <span className="ml-auto inline-flex h-5 items-center rounded-full bg-warning-soft px-2 text-[10px] font-semibold text-warning-soft-foreground">
                Needs reply
              </span>
            )}
          </div>
          <p className="mt-1 text-[14px] leading-[20px] text-foreground">{comment.text}</p>

          {/* 已回复:公开回复串在评论下 */}
          {reply && (
            <div className="mt-2 flex items-start gap-2 rounded-[10px] bg-secondary/60 px-3 py-2">
              <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <div className="min-w-0">
                <p className="text-[13px] leading-[19px] text-foreground">{reply.text}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Roti Bulan Bakery · replied {fmtWhen(reply.day, reply.time)}
                </p>
              </div>
            </div>
          )}

          {/* 就地 quick reply */}
          {!answered && !open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-1.5 text-[12px] font-semibold text-foreground hover:underline"
            >
              Reply publicly
            </button>
          )}
          {open && (
            <div className="mt-2 flex items-end gap-2 rounded-[12px] border border-border bg-card p-1.5">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a public reply…"
                rows={1}
                className="max-h-24 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-[18px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Button size="icon" className="size-8 shrink-0" disabled={!draft.trim()} onClick={submit} aria-label="Send reply">
                <Send strokeWidth={2} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("data");
  const [filter, setFilter] = React.useState<Filter>("unanswered");
  const [replies, setReplies] = React.useState<Record<string, { text: string; day: string; time: string }>>(() => {
    const seed: Record<string, { text: string; day: string; time: string }> = {};
    for (const c of IB_COMMENTS) if (c.reply) seed[c.id] = c.reply;
    return seed;
  });

  const addReply = (id: string, text: string) =>
    setReplies((prev) => ({ ...prev, [id]: { text, day: "2026-07-07", time: "12:04" } }));

  const unansweredCount = IB_COMMENTS.filter((c) => !replies[c.id]).length;

  const commentsFor = (postId: string) =>
    IB_COMMENTS.filter((c) => c.postId === postId).filter((c) => (filter === "unanswered" ? !replies[c.id] : true));

  const visiblePosts = IB_COMMENT_POSTS.filter((p) => commentsFor(p.id).length > 0);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "unanswered", label: "Needs reply", count: unansweredCount },
    { key: "all", label: "All", count: IB_COMMENTS.length },
  ];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Comments"
        subtitle="Public comments on your posts, gathered into one place to answer one by one."
        meta={[`${unansweredCount} need reply`]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors",
              filter === f.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {f.label}
            <span className="text-muted-foreground/70 tabular-nums">{f.count}</span>
          </button>
        ))}
      </div>

      {demo === "loading" && (
        <div className="mt-6 rounded-[18px] border border-border bg-card px-4 py-2">
          <ConversationRowsSkeleton rows={4} />
        </div>
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load comments." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "empty" && (
        <EmptyState
          icon={MessageCircle}
          title="No comments yet"
          body="When people comment on your published posts, they land here so you can reply without hopping between apps."
          className="mt-6"
        />
      )}

      {demo === "data" &&
        (visiblePosts.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="All caught up"
            body="Every public comment has a reply. Nice work."
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                Show all comments
              </Button>
            }
            className="mt-6"
          />
        ) : (
          <div className="mt-5 flex flex-col gap-5">
            {visiblePosts.map((post) => {
              const list = commentsFor(post.id);
              return (
                <section key={post.id} className="rounded-[18px] border border-border bg-card">
                  {/* 帖子头:缩略图 + caption + 平台 */}
                  <div className="flex items-center gap-3 border-b border-border p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.media}
                      alt=""
                      className="size-11 shrink-0 rounded-[10px] border border-border object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">{post.caption}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Posted {fmtWhen(post.postedDay, "09:00")}
                      </p>
                    </div>
                    <ChannelTag channel={post.platform} />
                  </div>

                  <div className="px-4">
                    {list.map((c) => (
                      <CommentRow key={c.id} comment={c} reply={replies[c.id]} onReply={addReply} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ))}

      <DemoStateBar value={demo} onChange={(v) => setDemo(v as DemoState)} />
      <MockNote path="/northstar/inbox/comments" />
    </div>
  );
}
