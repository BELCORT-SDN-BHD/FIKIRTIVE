/* @nsPage district="团队协作区" page="members" status="draft"
   sources="G-01;G-11+O-13 判决;harmony-01 §五;宪法 7 租户 RBAC" approvedAt="" pr="" */
"use client";

/**
 * 成员与席位管理 — 多席位协作的家(创作席 / 审批席双档)。
 * 清单要件:成员列表、seatType(CREATOR/APPROVER)、orgRole、邀请。
 *
 * harmony-01 §五:Membership 扩两个维度 —— seatType(计费按档数,G-01 双档)+
 *   orgRole(owner/admin/member 权限矩阵)。权限矩阵是「一张可读表,不是散落 if」。
 *
 * Otto 在场:这是身份与钱的决定(§O3 Account/connections/billing 一族)——
 *   **无 Otto 头像、无叙述条,dock only**;席位/邀请读起来是「你的」决定,不陪跑。
 *   加载走朴素 skeleton→内容(不由 Otto 铺面),与 Account 一族一致。
 * 布局:List archetype,880 单列(§L3);成员 = hairline 行(§D4 form A)。
 */

import * as React from "react";
import {
  Check,
  Crown,
  Mail,
  MoreHorizontal,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { EmptyState, MockNote, PageHeader, StatCard } from "@/components/northstar/_shared";
import {
  DemoStates,
  InitialsAvatar,
  InlineError,
  Landed,
  SeatBadge,
  SkeletonBlock,
  type DemoState,
} from "@/components/northstar/team/_bits";
import {
  MEMBERS,
  PERMISSION_MATRIX,
  ROLE_LABEL,
  SEAT_META,
  SEAT_BILLING,
  type Member,
  type SeatType,
} from "@/components/northstar/team/_data";

function MemberRow({
  member,
  first,
  onManage,
}: {
  member: Member;
  first: boolean;
  onManage: () => void;
}) {
  const invited = member.status === "invited";
  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3",
        !first && "border-t border-border",
        invited && "bg-muted/40",
      )}
    >
      <InitialsAvatar initials={member.initials} size={36} className={cn(invited && "opacity-60")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{member.name}</span>
          {member.orgRole === "owner" && (
            <Crown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-label="Owner" />
          )}
          {member.isSelf && <span className="text-xs text-muted-foreground">· you</span>}
        </div>
        <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
      </div>

      {/* orgRole */}
      <span className="hidden w-20 shrink-0 text-xs text-muted-foreground sm:block">{ROLE_LABEL[member.orgRole]}</span>

      {/* seatType */}
      <SeatBadge seatType={member.seatType} />

      {/* status / last active */}
      {invited ? (
        <Badge variant="warning" className="shrink-0">
          Invited
        </Badge>
      ) : (
        <span className="hidden w-20 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums md:block">
          {member.lastActive}
        </span>
      )}

      {/* 行动作(自己一行不给管理菜单) */}
      <button
        type="button"
        onClick={onManage}
        disabled={member.isSelf}
        aria-label={`Manage ${member.name}`}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-opacity",
          member.isSelf
            ? "invisible"
            : "opacity-0 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
        )}
      >
        <MoreHorizontal className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("default");
  // 无 Otto 铺面(§O3 dock only):默认已就绪;仅「加载」演示态用朴素定时器落定。
  const [landed, setLanded] = React.useState(true);
  const [members, setMembers] = React.useState<Member[]>(() => MEMBERS.map((m) => ({ ...m })));
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteSeat, setInviteSeat] = React.useState<SeatType>("CREATOR");
  const [manageId, setManageId] = React.useState<string | null>(null);

  const isLoading = demo === "loading";
  const isEmpty = demo === "empty";
  const isError = demo === "error";
  const show = landed && !isLoading && !isEmpty && !isError;

  const manageTarget = members.find((m) => m.id === manageId) ?? null;

  // 「加载」演示态:朴素 skeleton→内容(不由 Otto 铺面)。
  React.useEffect(() => {
    if (demo !== "loading") return;
    const t = window.setTimeout(() => setLanded(true), 1400);
    return () => window.clearTimeout(t);
  }, [demo]);

  function sendInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    const initials = email.slice(0, 2).toUpperCase();
    setMembers((prev) => [
      ...prev,
      {
        id: `mb-${prev.length + 1}`,
        name: email.split("@")[0] ?? email,
        email,
        initials,
        seatType: inviteSeat,
        orgRole: "member",
        status: "invited",
        lastActive: "invited just now",
      },
    ]);
    setInviteEmail("");
    setInviteSeat("CREATOR");
    setInviteOpen(false);
  }

  function setSeat(id: string, seatType: SeatType) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, seatType } : m)));
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Members and seats"
        subtitle="Everyone who works in your shop, and what they're allowed to do."
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)} disabled={!show}>
            <UserPlus strokeWidth={2} />
            Invite
          </Button>
        }
      />

      {/* 数据一行(§D3):两档席位数是计费口径(G-01) */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="People" value={show ? String(members.length) : "—"} />
        <StatCard label="Creator seats" value={show ? String(SEAT_BILLING.creatorSeats) : "—"} delta={{ dir: "flat", text: "full access" }} />
        <StatCard label="Approver seats" value={show ? String(SEAT_BILLING.approverSeats) : "—"} delta={{ dir: "flat", text: "review only" }} />
        <StatCard label="Invites out" value={show ? String(members.filter((m) => m.status === "invited").length) : "—"} delta={{ dir: "flat", text: "not accepted yet" }} />
      </div>

      {/* 成员列表 */}
      <div className="mt-6">
        {isError ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-card">
            <InlineError text="Couldn't load your team. Try again." onRetry={() => setDemo("default")} />
          </div>
        ) : isEmpty ? (
          <div className="flex rounded-[var(--radius-card)] border border-border bg-card">
            <EmptyState
              icon={Users}
              title="Just you for now"
              body="Invite a teammate to help make content, or add an approver to sign off before anything goes out."
              action={
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  <UserPlus strokeWidth={2} />
                  Invite
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Team
              </span>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{members.length} people</span>
            </div>
            {!show ? (
              <div className="flex flex-col gap-2 p-4">
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" shimmer={false} />
              </div>
            ) : (
              members.map((m, i) => (
                <Landed key={m.id} delayMs={(i % 5) * 60}>
                  <MemberRow member={m} first={i === 0} onManage={() => setManageId(m.id)} />
                </Landed>
              ))
            )}
          </div>
        )}
      </div>

      {/* 两档席位说明(G-01 双档的人话面) */}
      {show && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">Two kinds of seat</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["CREATOR", "APPROVER"] as SeatType[]).map((s) => (
              <div key={s} className="rounded-[var(--radius-card)] border border-border bg-card p-4">
                <SeatBadge seatType={s} />
                <p className="mt-2 text-sm font-semibold text-foreground">{SEAT_META[s].label}</p>
                <p className="mt-1 text-[13px] leading-[19px] text-muted-foreground">{SEAT_META[s].blurb}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            You're billed by the seats you fill. Approver seats cost less than creator seats.
          </p>
        </div>
      )}

      {/* 权限矩阵(一张可读表,harmony-01 §五) */}
      {show && (
        <div className="mt-8">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" strokeWidth={2} />
            <h2 className="text-sm font-semibold text-foreground">Who can do what</h2>
          </div>
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-card">
            <div className="min-w-[520px]">
              <div className="grid grid-cols-[1fr_repeat(3,72px)] items-center border-b border-border px-4 py-2.5">
                <span className="font-mono text-[10px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  Permission
                </span>
                {(["owner", "admin", "member"] as const).map((r) => (
                  <span
                    key={r}
                    className="text-center font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    {ROLE_LABEL[r]}
                  </span>
                ))}
              </div>
              {PERMISSION_MATRIX.map((row, i) => (
                <div
                  key={row.label}
                  className={cn(
                    "grid grid-cols-[1fr_repeat(3,72px)] items-center px-4 py-2.5",
                    i > 0 && "border-t border-border",
                  )}
                >
                  <span className="pr-3 text-[13px] text-foreground">{row.label}</span>
                  {([row.owner, row.admin, row.member] as boolean[]).map((ok, j) => (
                    <span key={j} className="flex justify-center">
                      {ok ? (
                        <Check className="size-4 text-success-soft-foreground" strokeWidth={2.5} aria-label="Yes" />
                      ) : (
                        <span className="text-muted-foreground/40" aria-label="No">
                          —
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 邀请 dialog(§FB5 M;非 spend,但发邀请消息 → 一个动作) */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-[min(480px,calc(100vw-2rem))]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendInvite();
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite a teammate</DialogTitle>
              <DialogDescription>They'll get an email to join your shop.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-col gap-5">
              <div>
                <label htmlFor="invite-email" className="text-[13px] leading-[18px] font-semibold text-foreground">
                  Email
                </label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="name@yourbrand.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-2"
                />
              </div>
              <div>
                <span className="text-[13px] leading-[18px] font-semibold text-foreground">Seat</span>
                <div className="mt-2 flex flex-col gap-2">
                  {(["CREATOR", "APPROVER"] as SeatType[]).map((s) => (
                    <label
                      key={s}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-[14px] border p-3 transition-colors",
                        inviteSeat === s ? "border-foreground bg-secondary/60" : "border-border hover:bg-accent/50",
                      )}
                    >
                      <input
                        type="radio"
                        name="seat"
                        value={s}
                        checked={inviteSeat === s}
                        onChange={() => setInviteSeat(s)}
                        className="mt-1 accent-[var(--primary)]"
                      />
                      <span className="min-w-0">
                        <span className="text-[13px] font-semibold text-foreground">{SEAT_META[s].label}</span>
                        <span className="mt-0.5 block text-xs leading-[17px] text-muted-foreground">
                          {SEAT_META[s].blurb}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="secondary" size="sm" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                <Mail strokeWidth={2} />
                Send invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 管理成员 dialog(改席位;owner 一行/自己一行不可达) */}
      <Dialog open={manageTarget != null} onOpenChange={(open) => !open && setManageId(null)}>
        <DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
          {manageTarget && (
            <>
              <DialogHeader>
                <DialogTitle>{manageTarget.name}</DialogTitle>
                <DialogDescription>{manageTarget.email}</DialogDescription>
              </DialogHeader>
              <div className="mt-4">
                <span className="text-[13px] leading-[18px] font-semibold text-foreground">Seat</span>
                <div className="mt-2 flex flex-col gap-2">
                  {(["CREATOR", "APPROVER"] as SeatType[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeat(manageTarget.id, s)}
                      className={cn(
                        "flex items-start gap-3 rounded-[14px] border p-3 text-left transition-colors",
                        manageTarget.seatType === s
                          ? "border-foreground bg-secondary/60"
                          : "border-border hover:bg-accent/50",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                          manageTarget.seatType === s ? "border-foreground bg-foreground" : "border-muted-foreground/50",
                        )}
                      >
                        {manageTarget.seatType === s && <Check className="size-3 text-background" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="text-[13px] font-semibold text-foreground">{SEAT_META[s].label}</span>
                        <span className="mt-0.5 block text-xs leading-[17px] text-muted-foreground">
                          {SEAT_META[s].blurb}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button variant="secondary" size="sm" onClick={() => setManageId(null)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/team/members" />
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
