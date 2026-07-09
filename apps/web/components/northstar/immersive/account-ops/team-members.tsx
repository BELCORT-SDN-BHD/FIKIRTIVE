"use client";

/**
 * 团队成员 —— 谁在里面、什么角色、占哪种席位、能做什么。店主取自 NS_BRAND。
 * 双档席位(G-01):每行标 creator(创作席)/ approver(审批席);底部一张说明卡讲清
 * 两档价差 —— 审批席便宜到老板愿意把全店都拉进来只为放行。
 * Manage 弹窗真改角色/席位/移出(写共享 store);Resend 给 toast + 冷却计时。
 * 交叉链接:待审批徽记 → team/approvals;角色说明讲清 spend/post 谁能拍板。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/northstar/_shared";
import {
  inviteMember,
  pendingApprovals,
  removeMember,
  setMemberRole,
  setMemberSeat,
  teamMembers,
  useStore,
} from "../_store";
import { ACCOUNT_OPS_BASE as BASE, TeamNav, Card, CardHeader, SettingRow } from "./kit";
import { ROLE_CAN, SEAT_TIERS, type NsMember, type NsSeatType } from "./data";

const RESEND_COOLDOWN_S = 30;

/** 席位徽记(创作席 outline / 审批席 secondary,与角色徽记并列) */
function SeatBadge({ seatType }: { seatType: NsSeatType }) {
  return (
    <Badge variant={seatType === "creator" ? "outline" : "default"}>
      {SEAT_TIERS[seatType].label}
    </Badge>
  );
}

function MemberRow({ member, onManage }: { member: NsMember; onManage: (m: NsMember) => void }) {
  const isOwner = member.role === "Owner";
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const resend = () => {
    setCooldown(RESEND_COOLDOWN_S);
    toast("Invite resent", { description: `We emailed ${member.email} again.` });
  };

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
      <SeatBadge seatType={member.seatType} />
      <Badge variant={isOwner ? "info" : "outline"}>{member.role}</Badge>
      {isOwner ? (
        <span className="px-2 text-xs font-medium text-muted-foreground">You</span>
      ) : member.status === "pending" ? (
        <Button variant="secondary" size="sm" disabled={cooldown > 0} onClick={resend}>
          {cooldown > 0 ? `Resent · ${cooldown}s` : "Resend"}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => onManage(member)}>
          Manage
        </Button>
      )}
    </div>
  );
}

export function TeamMembers() {
  useStore(); // 成员列表 + 待批计数的单一源(邀请/改席/移出真写、审批数派生)
  const members = teamMembers();
  const approvalsWaiting = pendingApprovals().length;
  const [inviting, setInviting] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [manageId, setManageId] = React.useState<string | null>(null);

  const managed = members.find((m) => m.id === manageId) ?? null;

  const sendInvite = () => {
    const invitee = email.trim();
    if (!invitee) return;
    setPending(true);
    window.setTimeout(() => {
      inviteMember(invitee); // 真 append 一条 pending Editor 进共享 store(列表即时长出)
      setPending(false);
      setInviting(false);
      setEmail("");
      toast("Invite sent", { description: `${invitee} joins as an editor on a creator seat.` });
    }, 700);
  };

  const remove = () => {
    if (!managed) return;
    removeMember(managed.id);
    toast("Removed from team", { description: `${managed.name} no longer has access.` });
    setManageId(null);
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
            <MemberRow key={m.id} member={m} onManage={(mm) => setManageId(mm.id)} />
          ))}
        </Card>
      </div>

      {/* 双档席位说明卡(G-01:两档价差,审批席便宜到全员可拉) */}
      <div className="mt-6">
        <Card>
          <CardHeader title="Seats" desc="You pay per seat. Pick the cheaper one for people who only approve." />
          <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
            {(Object.keys(SEAT_TIERS) as NsSeatType[]).map((k) => {
              const tier = SEAT_TIERS[k];
              return (
                <div key={k} className="flex flex-col gap-1.5 bg-card p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{tier.label}</span>
                    <span className="font-mono text-[13px] font-medium tabular-nums text-foreground">
                      RM {tier.priceMyr}
                      <span className="text-muted-foreground"> /mo</span>
                    </span>
                  </div>
                  <p className="text-[13px] leading-[18px] text-muted-foreground">{tier.can}</p>
                </div>
              );
            })}
          </div>
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs leading-4 text-muted-foreground">
              Approver seats are cheap on purpose — bring in a partner or your whole team just to review and approve,
              without paying for a full studio each.
            </p>
          </div>
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

      {/* 邀请弹窗 */}
      <Dialog open={inviting} onOpenChange={(open) => !open && !pending && setInviting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>
              They’ll join as an editor on a creator seat. You can change their role or seat any time. Editors draft
              freely — spend and posts still need approval.
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

      {/* Manage 弹窗:真改角色 / 席位 / 移出(写共享 store) */}
      <Dialog open={managed !== null} onOpenChange={(open) => !open && setManageId(null)}>
        <DialogContent>
          {managed && (
            <>
              <DialogHeader>
                <DialogTitle>Manage {managed.name}</DialogTitle>
                <DialogDescription>{managed.email}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-foreground">Role</span>
                  <Select value={managed.role} onValueChange={(v) => setMemberRole(managed.id, v as NsMember["role"])}>
                    <SelectTrigger className="h-11 w-full rounded-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Manager">Manager</SelectItem>
                      <SelectItem value="Editor">Editor</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">{ROLE_CAN[managed.role]}</span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-foreground">Seat</span>
                  <Select value={managed.seatType} onValueChange={(v) => setMemberSeat(managed.id, v as NsSeatType)}>
                    <SelectTrigger className="h-11 w-full rounded-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="creator">Creator seat · RM {SEAT_TIERS.creator.priceMyr}/mo</SelectItem>
                      <SelectItem value="approver">Approver seat · RM {SEAT_TIERS.approver.priceMyr}/mo</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">{SEAT_TIERS[managed.seatType].can}</span>
                </label>
              </div>
              <DialogFooter className="flex-row items-center justify-between gap-3">
                <Button variant="ghost" size="sm" className="text-error-soft-foreground" onClick={remove}>
                  <Trash2 strokeWidth={2} />
                  Remove
                </Button>
                <Button size="sm" onClick={() => setManageId(null)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
