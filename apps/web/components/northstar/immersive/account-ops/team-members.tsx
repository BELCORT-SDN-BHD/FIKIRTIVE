"use client";

/**
 * 团队成员 —— 谁在里面、什么角色、能做什么。店主取自 NS_BRAND。
 * 交叉链接:待审批徽记 → team/approvals;角色说明讲清 spend/post 谁能拍板。
 * §D4 hairline 行 + §FB5 邀请 dialog + §N3 状态色。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/northstar/_shared";
import { inviteMember, pendingApprovals, teamMembers, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, TeamNav, Card, CardHeader, SettingRow } from "./kit";
import { ROLE_CAN, type NsMember } from "./data";

function MemberRow({ member }: { member: NsMember }) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
        {member.initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{member.name}</p>
          {member.status === "pending" && <Badge variant="warning">Invited</Badge>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{member.email}</p>
      </div>
      <div className="hidden text-right sm:block">
        <p className="text-xs text-muted-foreground">{member.lastActive}</p>
      </div>
      <Badge variant={member.role === "Owner" ? "info" : "outline"}>{member.role}</Badge>
      <Button variant={member.status === "pending" ? "secondary" : "ghost"} size="sm">
        {member.status === "pending" ? "Resend" : "Manage"}
      </Button>
    </div>
  );
}

export function TeamMembers() {
  useStore(); // 成员列表 + 待批计数的单一源(邀请真 append、审批数派生)
  const members = teamMembers();
  const approvalsWaiting = pendingApprovals().length;
  const [inviting, setInviting] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const sendInvite = () => {
    const invitee = email.trim();
    if (!invitee) return;
    setPending(true);
    window.setTimeout(() => {
      inviteMember(invitee); // 真 append 一条 pending Editor 进共享 store(列表即时长出)
      setPending(false);
      setInviting(false);
      setEmail("");
    }, 700);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Team"
        subtitle="Invite your staff. You decide who can spend and who can publish."
        actions={
          <>
            <TeamNav />
            <Button size="sm" onClick={() => setInviting(true)}>
              <UserPlus strokeWidth={2} />
              Invite
            </Button>
          </>
        }
      />

      {approvalsWaiting > 0 && (
        <Link
          href={`${BASE}/team/approvals`}
          className="mt-6 flex items-center gap-3 rounded-[18px] border border-border bg-secondary/60 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-secondary"
        >
          <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
            {approvalsWaiting === 1
              ? "1 request is waiting for someone to approve."
              : `${approvalsWaiting} requests are waiting for someone to approve.`}
          </p>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-foreground">
            Review approvals
            <ArrowRight className="size-4" strokeWidth={2} />
          </span>
        </Link>
      )}

      <div className="mt-6">
        <Card>
          <CardHeader title="Members" desc={`${members.length} people`} />
          {members.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="What each role can do" />
          {(Object.keys(ROLE_CAN) as NsMember["role"][]).map((role) => (
            <SettingRow
              key={role}
              title={role}
              desc={ROLE_CAN[role]}
              control={<Badge variant={role === "Owner" ? "info" : "outline"}>{role}</Badge>}
            />
          ))}
        </Card>
      </div>

      <Dialog open={inviting} onOpenChange={(open) => !open && !pending && setInviting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>
              They'll join as an editor. You can change their role any time. Editors draft freely — spend and posts still need approval.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="name@rotibulan.my"
            aria-label="Teammate email"
          />
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending || !email.trim()} onClick={sendInvite}>
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
