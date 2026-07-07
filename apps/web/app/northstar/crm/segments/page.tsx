/* @nsPage district="CRM 区" page="segments" status="draft"
   sources="harmony-01 #13;P3-2;宪法 10" approvedAt="" pr="" */
"use client";

/**
 * 分群页(Segment) — 用人话描述 → 确定性规则编译 → 成员表。
 * 清单元素:规则的可读展示(不是节点画布)· 成员预览 · 供 broadcast / 自动化共用。
 * 宪法 10:人话是输入,产物是可读的确定性规则(AND 连接);编译由 Otto 做,
 *   narration 一屏一条,编译结果 sweep 一次(§O4 live-activity)。
 * §D4 hairline 成员行 · §V4 空态 · 勿扰恒在规则里(判决 7-9)。
 */

import * as React from "react";
import {
  ArrowRight,
  Filter,
  Megaphone,
  Plus,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, MockNote, OttoNarrationBar, PageHeader } from "@/components/northstar/_shared";
import {
  ChannelRow,
  ContactAvatar,
  DemoStateBar,
  DndTag,
  ErrorPanel,
  Skeleton,
  relDays,
  useSweep,
  type CrmDemoState,
} from "@/components/northstar/crm/kit";
import {
  CRM_COMPILE_DEMO,
  CRM_SEGMENTS,
  crmContact,
  type CrmRule,
  type CrmSegment,
} from "@/components/northstar/crm/mock-crm";

/* 编译 narration 步骤(§V6) */
const COMPILE_STEPS = [
  "Reading your description",
  "Compiling rules",
  "Finding members",
] as const;

function RuleChips({ rules }: { rules: CrmRule[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {rules.map((r, i) => (
        <React.Fragment key={`${r.field}-${i}`}>
          {i > 0 && (
            <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              and
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-secondary/60 px-2.5 py-1 text-xs">
            <span className="font-medium text-foreground">{r.field}</span>
            <span className="text-muted-foreground">{r.op}</span>
            <span className="font-semibold text-foreground">{r.value}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function UsedByRow({ usedBy }: { usedBy: CrmSegment["usedBy"] }) {
  if (usedBy.length === 0) {
    return <span className="text-xs text-muted-foreground">Not used yet</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {usedBy.map((u) => {
        const Icon = u.kind === "broadcast" ? Megaphone : Workflow;
        return (
          <span
            key={u.name}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] leading-[16px] text-muted-foreground"
          >
            <Icon className="size-3 shrink-0" strokeWidth={2} />
            {u.name}
          </span>
        );
      })}
    </div>
  );
}

function MemberPreview({ segment }: { segment: CrmSegment }) {
  const members = segment.memberIds.map(crmContact);
  if (members.length === 0) {
    return (
      <p className="rounded-[12px] bg-secondary/50 px-3 py-4 text-center text-xs text-muted-foreground">
        No contacts match these rules right now. This segment stays empty until one does.
      </p>
    );
  }
  return (
    <div className="rounded-[12px] border border-border">
      {members.slice(0, 4).map((c, i) => (
        <div
          key={c.id}
          className={cn("flex items-center gap-2.5 px-3 py-2", i > 0 && "border-t border-border")}
        >
          <ContactAvatar name={c.name} size={28} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{c.name}</span>
          <ChannelRow channels={c.channels} />
          {c.doNotDisturb && <DndTag />}
          <span className="hidden text-[11px] text-muted-foreground sm:inline">seen {relDays(c.lastSeen)}</span>
        </div>
      ))}
      {members.length > 4 && (
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          +{members.length - 4} more in this segment
        </div>
      )}
    </div>
  );
}

function SegmentCard({ segment, swept }: { segment: CrmSegment; swept?: boolean }) {
  const { style, fire } = useSweep();
  React.useEffect(() => {
    if (swept) fire();
  }, [swept, fire]);

  return (
    <section
      className={cn("rounded-[18px] border border-border bg-card p-5", swept && "fade-rise")}
      style={style}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-secondary">
          <Filter className="size-4 text-secondary-foreground" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{segment.name}</h2>
          <p className="mt-0.5 text-sm leading-[20px] text-muted-foreground">{segment.description}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-foreground tabular-nums">
          <Users className="size-3.5 text-muted-foreground" strokeWidth={2} />
          {segment.memberIds.length}
        </span>
      </div>

      {/* 编译产物:可读规则(不是节点画布) */}
      <div className="mt-4">
        <p className="mb-2 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Rules
        </p>
        <RuleChips rules={segment.rules} />
      </div>

      {/* 成员预览 */}
      <div className="mt-4">
        <p className="mb-2 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Members
        </p>
        <MemberPreview segment={segment} />
      </div>

      {/* 共用去向 + 编译时间 */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <UsedByRow usedBy={segment.usedBy} />
        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
          compiled {segment.lastCompiled}
        </span>
      </div>
    </section>
  );
}

/* 新分群 dialog:人话 → Otto 编译 → 可读规则 + 成员(确定性演示) */
function NewSegmentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (segment: CrmSegment) => void;
}) {
  const [text, setText] = React.useState(CRM_COMPILE_DEMO.description);
  const [phase, setPhase] = React.useState<"input" | "compiling" | "result">("input");

  // 关闭即重置(在事件里同步复位,不用 effect);编译中不可关。
  const close = () => {
    if (phase === "compiling") return;
    setPhase("input");
    setText(CRM_COMPILE_DEMO.description);
    onClose();
  };

  const compile = () => setPhase("compiling");
  const onCompiled = () => setPhase("result");

  const create = () => {
    onCreated({
      id: "seg-new",
      name: "Office croissant regulars",
      description: text.trim(),
      rules: CRM_COMPILE_DEMO.rules,
      memberIds: CRM_COMPILE_DEMO.memberIds,
      usedBy: [],
      lastCompiled: "just now",
    });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>
            Describe the people you want in plain words. Otto turns it into rules you can read.
          </DialogDescription>
        </DialogHeader>

        {phase === "input" && (
          <div className="flex flex-col gap-2">
            <label htmlFor="seg-desc" className="text-[13px] font-semibold text-foreground">
              Who should be in this segment?
            </label>
            <Textarea
              id="seg-desc"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="e.g. Regulars who spent over RM300 and messaged this month"
            />
            <p className="text-xs text-muted-foreground">
              Do not disturb is always respected. Contacts on that list are never added.
            </p>
          </div>
        )}

        {phase === "compiling" && (
          <div className="flex flex-col gap-3 py-2">
            <OttoNarrationBar key="seg-compile" steps={COMPILE_STEPS} stepMs={850} counter onSettle={onCompiled} />
            <Skeleton className="h-8 w-full" shimmer />
            <Skeleton className="h-8 w-4/5" />
          </div>
        )}

        {phase === "result" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-[12px] bg-secondary/60 p-3">
              <p className="mb-2 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Rules Otto compiled
              </p>
              <RuleChips rules={CRM_COMPILE_DEMO.rules} />
            </div>
            <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
              <Users className="size-4 text-muted-foreground" strokeWidth={2} />
              <span className="font-semibold tabular-nums">{CRM_COMPILE_DEMO.memberIds.length}</span> contacts match
              right now.
            </p>
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" disabled={phase === "compiling"} onClick={close}>
            Cancel
          </Button>
          {phase === "input" && (
            <Button size="sm" onClick={compile} disabled={text.trim().length === 0}>
              Compile rules
            </Button>
          )}
          {phase === "compiling" && (
            <Button size="sm" disabled>
              Compiling…
            </Button>
          )}
          {phase === "result" && (
            <Button size="sm" onClick={create}>
              Save segment
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<CrmDemoState>("data");
  const [segments, setSegments] = React.useState<CrmSegment[]>(CRM_SEGMENTS);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [sweptId, setSweptId] = React.useState<string | null>(null);

  const onCreated = (segment: CrmSegment) => {
    setSegments((prev) => [segment, ...prev]);
    setSweptId(segment.id);
  };

  const totalMembers = new Set(segments.flatMap((s) => s.memberIds)).size;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Segments"
        subtitle="Describe a group of customers in plain words. Otto turns it into rules you can read and reuse."
        meta={[`${segments.length} segments`, `${totalMembers} contacts covered`]}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus strokeWidth={2} />
            New segment
          </Button>
        }
      />

      {/* 说明条:人话 → 规则 → 成员表(宪法 10) */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">Plain words</span>
        <ArrowRight className="size-3.5" strokeWidth={2} />
        <span className="font-medium text-foreground">Readable rules</span>
        <ArrowRight className="size-3.5" strokeWidth={2} />
        <span className="font-medium text-foreground">A live member list</span>
        <span className="ml-1">that broadcasts and automations share.</span>
      </div>

      {demo === "loading" && (
        <div className="mt-4 flex flex-col gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-[18px] border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-[12px]" shimmer={i === 0} />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" shimmer={i === 1} />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
              <Skeleton className="mt-4 h-8 w-full" />
              <Skeleton className="mt-3 h-24 w-full" />
            </div>
          ))}
        </div>
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load your segments." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "empty" && (
        <EmptyState
          icon={Filter}
          title="No segments yet"
          body="Describe a group of customers in plain words and Otto will build your first segment."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              New segment
            </Button>
          }
          className="mt-6"
        />
      )}

      {demo === "data" && (
        <div className="mt-4 flex flex-col gap-4">
          {segments.map((s) => (
            <SegmentCard key={s.id} segment={s} swept={s.id === sweptId} />
          ))}
        </div>
      )}

      <NewSegmentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={onCreated} />
      <DemoStateBar value={demo} onChange={setDemo} />
      <MockNote path="/northstar/crm/segments" />
    </div>
  );
}
