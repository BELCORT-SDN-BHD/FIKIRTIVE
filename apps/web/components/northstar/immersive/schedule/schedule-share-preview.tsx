"use client";

/**
 * 排期区 · Share preview（§L2 Detail 760）— 原生重建。
 * 无席位链接式外审:token URL + 有效期 Select + Regenerate（tier-2 确认）;只读镜像。
 * 此页无 Otto inline（dock only）。?post=<id> 覆盖缺省样例,任意一帖都可外审。
 */

import * as React from "react";
import { Copy, Eye, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/northstar/_shared";
import { NS_BRAND } from "@/components/northstar/_mock";
import {
  CampaignPill,
  NS_TODAY,
  PLATFORMS,
  PlatformTag,
  StatusBadge,
  addDaysIso,
  campaignPosts,
  fmtDate,
  fmtDateLong,
  fmtTime,
  livePosts,
} from "./kit";
import { useStore } from "../_store";
import { useQueryParam } from "../_kit";

const DEFAULT_POST_ID = "post-04";
const TOKENS = ["rb-7f3k9d2m1x", "rb-2p8w5q0j4t"];
const EXPIRY_OPTIONS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

export function ScheduleSharePreview() {
  useStore();
  const [tokenIdx, setTokenIdx] = React.useState(0);
  const [expiryDays, setExpiryDays] = React.useState("7");
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [regenPending, setRegenPending] = React.useState(false);

  const wantId = useQueryParam("post");
  const camp = campaignPosts();
  const allPosts = [...livePosts(), ...camp.scheduled, ...camp.proposed];
  const post =
    (wantId ? allPosts.find((p) => p.id === wantId) : undefined) ??
    allPosts.find((p) => p.id === DEFAULT_POST_ID) ??
    allPosts[0]!;
  const token = TOKENS[tokenIdx % TOKENS.length];
  const url = `https://fikirtive.app/p/${token}`;
  const expiresOn = addDaysIso(NS_TODAY, Number(expiryDays));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", { description: "Anyone with it can view this post. View only." });
    } catch {
      toast("Couldn't copy the link. Select it and copy manually.");
    }
  };
  const confirmRegen = () => {
    setRegenPending(true);
    window.setTimeout(() => {
      setTokenIdx((i) => i + 1);
      setRegenPending(false);
      setRegenOpen(false);
    }, 600);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Share preview"
        subtitle="Send one post for outside review. Viewers don't need a seat or an account."
      />

      <section className="mt-6 rounded-[18px] border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">Review link</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-input bg-background px-3.5">
            <Link2 className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <span className="truncate font-mono text-sm text-foreground">{url}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={copyLink}>
            <Copy strokeWidth={2} />
            Copy link
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] leading-[18px] font-semibold text-foreground">Expires after</span>
            <Select value={expiryDays} onValueChange={setExpiryDays}>
              <SelectTrigger className="h-11 w-40 rounded-[14px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="pb-3 text-xs text-muted-foreground">Expires {fmtDate(expiresOn)}.</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setRegenOpen(true)}>
            <RefreshCw strokeWidth={2} />
            Regenerate link
          </Button>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-xs leading-4 text-muted-foreground">
          Anyone with the link sees a read-only copy of this post. They can't edit, approve or see anything else in your account.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">What reviewers see</h2>
        <div className="mt-3 overflow-hidden rounded-[18px] border border-border bg-background">
          <div className="flex items-center gap-2 bg-info-soft px-4 py-2" role="note">
            <Eye className="size-3.5 shrink-0 text-info-soft-foreground" strokeWidth={2} />
            <span className="text-xs font-medium text-info-soft-foreground">
              Read-only preview · no sign-in needed · expires {fmtDate(expiresOn)}
            </span>
          </div>
          <div className="mx-auto w-full max-w-[480px] px-6 py-10">
            <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
              <div className="flex items-center gap-2">
                <PlatformTag platform={post.platform} />
                <span className="text-[13px] font-semibold text-foreground">{PLATFORMS[post.platform].handle}</span>
                <div className="flex-1" />
                <StatusBadge status={post.status} />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.media} alt={post.altText ?? ""} className="aspect-square w-full rounded-[14px] border border-border object-cover" />
              <p className="text-[15px] leading-[22px] text-foreground">{post.caption}</p>
              {post.firstComment && (
                <p className="border-t border-border pt-2 text-[13px] leading-[18px] text-muted-foreground">First comment: {post.firstComment}</p>
              )}
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Goes out {fmtDateLong(post.date)} · {fmtTime(post.time)} (UTC+8)</p>
                {post.campaignName && <CampaignPill id={post.campaignId} name={post.campaignName} asLink={false} className="ml-auto" />}
              </div>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">Shared by {NS_BRAND.name} · made with FIKIRTIVE</p>
          </div>
        </div>
      </section>

      <Dialog open={regenOpen} onOpenChange={(open) => !open && !regenPending && setRegenOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this link?</DialogTitle>
            <DialogDescription>What happens:</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5 rounded-[14px] bg-secondary/70 p-3 text-[13px] leading-[18px] text-foreground">
            <li>The old link stops working immediately.</li>
            <li>Anyone still using it sees an expired page.</li>
            <li>You get a fresh link with the same expiry.</li>
          </ul>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" disabled={regenPending} onClick={() => setRegenOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={regenPending} onClick={confirmRegen}>
              {regenPending ? "Regenerating…" : "Regenerate link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
