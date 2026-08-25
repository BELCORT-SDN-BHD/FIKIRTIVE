"use client";

/**
 * ApprovalCard.tsx —— 一张审批卡。列表优先:详情在卡里展开,不跳走。
 *
 * 八件里落在这张卡上的:
 *   ① 三态动作(Approve / Ask <名字> to revise / Reject),收件人跟着来源走。
 *   ② `a` / `r` / `x` 三个快捷键 —— 输入框聚焦时一概不触发(守卫在 `isTypingTarget`)。
 *   ③ Details 展开双页签。
 *   ④ V2 徽章、What changed、以及随卡可见的「已结清」旧意见。
 *   ⑤ 阻断芯片 + Fix with Otto;被阻断时 Approve 禁用,并用 `aria-describedby` 把
 *      「为什么不能批」接到那颗按钮上,不是让读屏的人自己去找那段字。
 *   ⑥ 钱贴动作:有费卡写成 `Approve · 16 cr`,后果句就在按钮上一行。
 *   ⑧ 「Decide by …」与 slot 时间彼此独立;临期由 `isDecideByUrgent` 一处判定。
 */

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { ApprovalDetail, approvalDetailId } from "./ApprovalDetail";
import { ApprovalThumb } from "./ApprovalThumb";
import { ReviseFlow, type ReviseMode } from "./ReviseFlow";
import {
  creditSuffix,
  isDecideByUrgent,
  reviseRecipient,
  type ApprovalDetailTab,
  type ApprovalItem,
} from "./approvals-fixture";

export type MenuAction = "handled" | "superseded" | "canceled" | "explain" | "copy";

export type ApprovalCardHandlers = {
  onSelect: (id: string, checked: boolean) => void;
  onApprove: (item: ApprovalItem) => void;
  onBegin: (item: ApprovalItem, mode: ReviseMode) => void;
  onToggleDetail: (item: ApprovalItem) => void;
  onDetailTab: (tab: ApprovalDetailTab) => void;
  onFixWithOtto: (item: ApprovalItem) => void;
  onMenu: (item: ApprovalItem, action: MenuAction) => void;
  onOpenVersion: (id: string) => void;
  onReason: (reason: string) => void;
  onNote: (note: string) => void;
  onSubmitRevise: () => void;
  onCancelRevise: () => void;
};

export type CardReviseState = { mode: ReviseMode; count: number; reason: string; note: string };

/**
 * ② 快捷键的守卫。商家在理由框里打 "a rule I set" 时,每一个 a 都不该批掉一张卡。
 * 判 `target` 而不是判「面板开着没有」:面板关着但焦点在别的输入框里,同样不该触发。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  if (node.isContentEditable) return true;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT";
}

export function ApprovalCard({
  item,
  waiting,
  busy,
  anyBusy,
  selected,
  expanded,
  detailTab,
  revise,
  handlers,
}: {
  item: ApprovalItem;
  waiting: boolean;
  busy: boolean;
  anyBusy: boolean;
  selected: boolean;
  expanded: boolean;
  detailTab: ApprovalDetailTab;
  revise: CardReviseState | null;
  handlers: ApprovalCardHandlers;
}) {
  const blocked = Boolean(item.blocker);
  const urgent = isDecideByUrgent(item);
  const recipient = reviseRecipient(item);
  const blockerId = `r22-approval-blocker-${item.id}`;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!waiting || anyBusy) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "a") {
      event.preventDefault();
      if (!blocked) handlers.onApprove(item);
      return;
    }
    if (key === "r") {
      event.preventDefault();
      handlers.onBegin(item, "revise");
      return;
    }
    if (key === "x") {
      event.preventDefault();
      handlers.onSelect(item.id, !selected);
    }
  }

  return (
    <article
      className={`r22-approvals-item${revise ? " is-rejecting" : ""}${busy ? " is-busy" : ""}`}
      data-approval-id={item.id}
      tabIndex={0}
      aria-busy={busy || undefined}
      onKeyDown={handleKeyDown}
    >
      <header className="r22-approvals-item-head">
        {waiting ? <Checkbox unstyled className="r22-approvals-check" aria-label={`Select: ${item.title}`} checked={selected} onCheckedChange={(checked) => handlers.onSelect(item.id, checked === true)} /> : null}
        <b>{item.title}</b>
        {item.version ? <span className="r22-approvals-badge">V{item.version}</span> : null}
        <span className={`r22-approvals-origin${item.source === "otto" ? " is-otto" : ""}`}>{item.source === "otto" ? <i /> : <em>A</em>}{item.origin}</span>
        <span className="r22-approvals-price">{item.cost ? waiting ? `${item.cost} cr` : `${item.cost} cr spent` : "Free to schedule"}</span>
        {waiting && item.decideBy ? <span className={`r22-approvals-deadline${urgent ? " is-urgent" : ""}`}>Decide by {item.decideBy}{urgent ? ` · ${item.decideByHours} hours left` : ""}</span> : null}
      </header>

      <div className="r22-approvals-body">
        {item.images?.length || item.pendingImage ? (
          <div className="r22-approvals-thumbs">
            {item.images?.map((image, index) => <ApprovalThumb src={image} key={`${item.id}-${index}`} />)}
            {item.pendingImage ? <span className="r22-approvals-thumb is-pending">To make</span> : null}
            {item.moreImages ? <Button unstyled type="button" className="r22-approvals-thumb is-more" aria-label={`Preview ${item.moreImages} more images`}>+{item.moreImages}</Button> : null}
          </div>
        ) : null}
        {item.previousTime && item.nextTime ? <p className="r22-approvals-diff"><span>{item.previousTime}</span><i>→</i><b>{item.nextTime}</b></p> : null}
        <p className="r22-approvals-facts">{item.when ? <><span>{item.when}</span> · </> : null}{item.detail}</p>
        {item.whatChanged ? <p className="r22-approvals-changed"><b>What changed</b> {item.whatChanged}</p> : null}
        {item.settledFeedback ? <p className="r22-approvals-settled">Settled · {item.settledFeedback}</p> : null}
        {item.blocker ? (
          <div className="r22-approvals-blocker">
            <div>
              <span className="r22-approvals-chip">{item.blocker.chip}</span>
              <Button unstyled type="button" disabled={anyBusy} onClick={() => handlers.onFixWithOtto(item)}>Fix with Otto</Button>
            </div>
            <p id={blockerId}>{item.blocker.why}</p>
          </div>
        ) : null}
        {item.sources?.length ? <div className="r22-approvals-sources"><span>Based on</span>{item.sources.map((source) => <Button unstyled type="button" key={source}>{source}</Button>)}</div> : null}
      </div>

      {waiting ? (
        <footer className="r22-approvals-actions">
          {item.consequence ? <p className="r22-approvals-consequence">{item.consequence}</p> : null}
          <div className="r22-approvals-actionrow">
            <Button unstyled type="button" disabled={anyBusy || blocked} aria-describedby={blocked ? blockerId : undefined} onClick={() => handlers.onApprove(item)}>{busy ? "Approving…" : `Approve${creditSuffix(item.cost)}`}</Button>
            <Button unstyled type="button" disabled={anyBusy} onClick={() => handlers.onBegin(item, "revise")}>Ask {recipient} to revise</Button>
            <Button unstyled type="button" disabled={anyBusy} onClick={() => handlers.onBegin(item, "reject")}>Reject</Button>
            <Button unstyled type="button" aria-expanded={expanded} aria-controls={approvalDetailId(item.id)} onClick={() => handlers.onToggleDetail(item)}>{expanded ? "Hide details" : "Details"}</Button>
            <Link href={item.openHref ?? "/campaign?fixture=r22"}>{item.openLabel ?? "Open in campaign"}</Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button unstyled type="button" disabled={anyBusy} className="r22-approvals-more" aria-label="More actions"><Ellipsis data-icon="inline-start" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => handlers.onMenu(item, "handled")}>Mark handled</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handlers.onMenu(item, "superseded")}>Mark superseded</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handlers.onMenu(item, "canceled")}>Cancel request</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handlers.onMenu(item, "explain")}>Ask Otto why</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handlers.onMenu(item, "copy")}>Copy link</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </footer>
      ) : (
        <div className="r22-approvals-decision">
          <p>{item.decision}</p>
          {item.supersededBy ? <Button unstyled type="button" onClick={() => handlers.onOpenVersion(item.supersededBy!)}>See the new version</Button> : null}
          <Button unstyled type="button" aria-expanded={expanded} aria-controls={approvalDetailId(item.id)} onClick={() => handlers.onToggleDetail(item)}>{expanded ? "Hide details" : "Details"}</Button>
        </div>
      )}

      {expanded ? <ApprovalDetail item={item} tab={detailTab} onTab={handlers.onDetailTab} /> : null}

      {revise ? (
        <ReviseFlow
          mode={revise.mode}
          count={revise.count}
          recipient={recipient}
          reason={revise.reason}
          note={revise.note}
          busy={anyBusy}
          onReason={handlers.onReason}
          onNote={handlers.onNote}
          onSubmit={handlers.onSubmitRevise}
          onCancel={handlers.onCancelRevise}
        />
      ) : null}
    </article>
  );
}

export default ApprovalCard;
