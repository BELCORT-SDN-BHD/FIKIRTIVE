"use client";

/**
 * ApprovalCard.tsx —— 一张审批卡。**卡就是那条帖子**。
 *
 * v2 稿把这张卡切成三段,顺序就是商家读它的顺序:
 *   ① `ap-meta` —— 谁在发、发去哪、什么时候发,以及**什么时候之前得给答复**。一个字号、
 *      一个颜色,从左到右一行读完。
 *   ② `ap-post` —— 帖子本体:关注者会读到的那句话在上,按真实比例出现的图在下。
 *      这一段是主角,卡上最大的字在这里,也只有这里。
 *   ③ `ap-foot` —— 批准会发生什么(后果贴着动作),然后是三个出口。
 *
 * v1 的卡头写的是我们给这条东西起的名字(`title`),图被裁成 46×58 的小方块。商家批的是
 * 一条要发给关注者的帖子,却在屏幕上看不到那条帖子 —— 换皮换掉的就是这件事。
 *
 * 八件行为一件没动,只是换了住处:
 *   ① 三态动作(Approve / Ask <名字> to revise / Reject),收件人跟着来源走。
 *   ② `a` / `r` / `x` 三个快捷键 —— 输入框聚焦时一概不触发(守卫在 `isTypingTarget`)。
 *   ③ Details 展开双页签。
 *   ④ 版本号、What changed、以及随卡可见的「已结清」旧意见,都进了 ② 的注解位。
 *   ⑤ 阻断从一个方框变成 ③ 里的一行字 + Fix with Otto;被阻断时 Approve 仍然禁用,
 *      并用 `aria-describedby` 把「为什么不能批」接到那颗按钮上。
 *   ⑥ 钱贴动作:有费卡写成 `Approve · 16 credits`,后果句就在按钮上一行,金额用等宽。
 *   ⑧ 「Decide by …」与 slot 时间彼此独立;临期由 `isDecideByUrgent` 一处判定。
 */

import Link from "next/link";
import { Camera, Ellipsis, Megaphone, TriangleAlert } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { ApprovalDetail, approvalDetailId } from "./ApprovalDetail";
import { ApprovalThumb } from "./ApprovalThumb";
import { ReviseFlow, type ReviseMode } from "./ReviseFlow";
import {
  creditSuffix,
  credits,
  isDecideByUrgent,
  ratioClass,
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
  /** 稿:点一张图开审阅层,看的是这条 `previews` 里的第几张。 */
  onOpenPreview: (item: ApprovalItem, previewIndex: number) => void;
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

/** 稿:键盘发起的动作**一点动效都不带**。摸着键盘连批时,每张卡再飞一次是晕的。 */
export const KEYBOARD_MOTION_MS = 420;

export function markKeyboardMotion(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-kb", "1");
  window.clearTimeout(Number(root.dataset.kbTimer ?? 0));
  root.dataset.kbTimer = String(window.setTimeout(() => {
    root.removeAttribute("data-kb");
    delete root.dataset.kbTimer;
  }, KEYBOARD_MOTION_MS));
}

/**
 * ⑥ 后果句里的金额用等宽字,和余额、账本上的数字对得齐。
 * 拆的是**已经写好的那句话**,不是另存一个金额字段 —— 屏幕上的数字只有一个出处。
 */
function consequenceParts(text: string, cost: number): [string, string, string] | null {
  if (cost <= 0) return null;
  const token = credits(cost);
  const at = text.indexOf(token);
  if (at < 0) return null;
  return [text.slice(0, at), token, text.slice(at + token.length)];
}

/** ⑧ 非待审卡右上角那枚状态芯片,写这条最后落到哪儿去了。 */
function resolvedChip(item: ApprovalItem): string {
  if (item.resolution === "approved") return "Scheduled";
  if (item.resolution === "superseded") return `Version ${item.version ?? 1}`;
  if (item.resolution === "canceled") return "Canceled";
  return "Not scheduled";
}

export function ApprovalCard({
  item,
  index,
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
  index: number;
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
  const media = item.media ?? [];
  const conseq = item.consequence ? consequenceParts(item.consequence, item.cost) : null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!waiting || anyBusy) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "a") {
      event.preventDefault();
      markKeyboardMotion();
      if (!blocked) handlers.onApprove(item);
      return;
    }
    if (key === "r") {
      event.preventDefault();
      markKeyboardMotion();
      handlers.onBegin(item, "revise");
      return;
    }
    if (key === "x") {
      event.preventDefault();
      markKeyboardMotion();
      handlers.onSelect(item.id, !selected);
    }
  }

  return (
    <article
      className={`r22-approvals-item${selected ? " is-selected" : ""}${revise ? " is-rejecting" : ""}${busy ? " is-busy" : ""}${waiting ? "" : " is-done"}`}
      data-approval-id={item.id}
      /** 稿:逐卡 45ms 的入场错位。序号是数据,动效本身在 css 里。 */
      style={{ "--r22-approvals-stagger": index } as CSSProperties}
      data-approval-stagger={index}
      tabIndex={0}
      aria-busy={busy || undefined}
      onKeyDown={handleKeyDown}
    >
      {/* ① 谁在发、发去哪、什么时候发,以及什么时候之前得给答复 */}
      <header className="r22-approvals-meta">
        {waiting ? <Checkbox unstyled className="r22-approvals-check" aria-label={`Select: ${item.title}`} checked={selected} onCheckedChange={(checked) => handlers.onSelect(item.id, checked === true)} /> : null}
        <span className="r22-approvals-chico" aria-hidden="true">{item.channel === "facebook" ? <Megaphone /> : <Camera />}</span>
        <span className="r22-approvals-metaline">
          <span>{item.detail}</span>
          {item.when ? <><i className="r22-approvals-sep">·</i><time>{item.when}</time></> : null}
          <i className="r22-approvals-sep">·</i>
          {item.source === "otto"
            ? <i className="r22-approvals-dot" />
            : <i className="r22-approvals-av">{item.origin.trim().charAt(0).toUpperCase()}</i>}
          <span>{item.origin}</span>
        </span>
        {waiting && item.decideBy
          ? <span className={`r22-approvals-by${urgent ? " is-urgent" : ""}`}>Decide by <time>{item.decideBy}</time>{urgent ? <>{" · "}{item.decideByHours} hours left</> : null}</span>
          : !waiting ? <span className="r22-approvals-by">{resolvedChip(item)}</span> : null}
      </header>

      {/* ② 帖子本体 —— 关注者会读到的字,和按真实比例出现的图 */}
      <div className="r22-approvals-post">
        <p className="r22-approvals-cap">{item.caption}</p>
        {item.note ? <p className="r22-approvals-note">{item.note}</p> : null}
        {item.whatChanged ? <p className="r22-approvals-changed">{item.version ? `Version ${item.version} · ` : ""}{item.whatChanged}</p> : null}
        {item.settledFeedback ? <p className="r22-approvals-settled">Settled · {item.settledFeedback}</p> : null}
        {media.length ? (
          <div className={`r22-approvals-media${media.length > 1 ? " is-many" : ""}`}>
            {media.map((tile, tileIndex) => {
              const preview = tile.previewIndex !== undefined ? item.previews?.[tile.previewIndex] : undefined;
              if (!tile.image || !preview) {
                return <span className={`r22-approvals-shot is-pending ${ratioClass(tile.ratio)}`} key={`${item.id}-shot-${tileIndex}`}><span>Not made yet</span></span>;
              }
              return (
                <Button
                  unstyled
                  type="button"
                  key={`${item.id}-shot-${tileIndex}`}
                  className={`r22-approvals-shot ${ratioClass(tile.ratio)}`}
                  aria-label={`Open the full preview of the ${preview.platform} post${preview.slot ? ` for ${preview.slot}` : ""}`}
                  onClick={() => handlers.onOpenPreview(item, tile.previewIndex!)}
                >
                  <ApprovalThumb src={tile.image} className="r22-approvals-frame-img" />
                </Button>
              );
            })}
          </div>
        ) : null}
      </div>

      {waiting ? (
        /* ③ 批准会发生什么,然后是三个出口 */
        <footer className="r22-approvals-foot">
          {item.blocker ? (
            <p className="r22-approvals-block">
              <TriangleAlert aria-hidden="true" />
              <span id={blockerId}>{item.blocker.chip}. {item.blocker.why}</span>
              <Button unstyled type="button" disabled={anyBusy} onClick={() => handlers.onFixWithOtto(item)}>Fix with Otto</Button>
            </p>
          ) : null}
          {item.consequence ? <p className="r22-approvals-conseq">{conseq ? <>{conseq[0]}<b>{conseq[1]}</b>{conseq[2]}</> : item.consequence}</p> : null}
          <div className="r22-approvals-acts">
            <Button unstyled type="button" disabled={anyBusy || blocked} aria-describedby={blocked ? blockerId : undefined} onClick={() => handlers.onApprove(item)}>{busy ? "Approving…" : `Approve${creditSuffix(item.cost)}`}</Button>
            <Button unstyled type="button" disabled={anyBusy} onClick={() => handlers.onBegin(item, "revise")}>Ask {recipient} to revise</Button>
            <Button unstyled type="button" disabled={anyBusy} onClick={() => handlers.onBegin(item, "reject")}>Reject</Button>
            <Button unstyled type="button" aria-expanded={expanded} aria-controls={approvalDetailId(item.id)} onClick={() => handlers.onToggleDetail(item)}>{expanded ? "Hide details" : "Details"}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button unstyled type="button" disabled={anyBusy} className="r22-approvals-more" aria-label="More actions"><Ellipsis /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="r22-approvals-pop">
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild><Link href={item.openHref ?? "/campaign?fixture=r22"}>{item.openLabel ?? "Open in campaign"}</Link></DropdownMenuItem>
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
