"use client";

/**
 * ApprovalLayer.tsx —— 审阅层。图是主角,决定坐在它旁边。
 *
 * 稿的第三段:卡上的图点开之后,画面左边是这条内容在这个平台上的真实比例,右边是做这个
 * 决定需要的全部话 —— 谁、什么时候、写了什么、为什么长这样、合不合这个位、批不了的话
 * 为什么批不了,最后是那句问句和三个出口。
 *
 * 两件事必须跟着决定一起走进这一层,不能留在卡上:
 *   ⑤ 阻断的那句话 —— 一颗禁用的 Approve 不许在这里孤零零地灰着不说为什么;
 *   ⑥ 金额 —— 按钮在这里也写 `Approve · 16 credits`,不是回到卡上才算数。
 *
 * 这一层只是同一批动作的第二个入口:批准、改版、拒绝都调用壳里那三个同名回调,
 * 没有第二套判断,也没有第二份状态。
 */

import { Camera, Megaphone, TriangleAlert } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { ApprovalThumb } from "./ApprovalThumb";
import type { ReviseMode } from "./ReviseFlow";
import { creditSuffix, ratioClass, reviseRecipient, type ApprovalItem } from "./approvals-fixture";

export function ApprovalLayer({
  item,
  index,
  onIndex,
  onClose,
  onApprove,
  onBegin,
}: {
  item: ApprovalItem;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onApprove: (item: ApprovalItem) => void;
  onBegin: (item: ApprovalItem, mode: ReviseMode) => void;
}) {
  const previews = item.previews ?? [];
  const preview = previews[index] ?? previews[0];
  if (!preview) return null;

  const blocked = Boolean(item.blocker);
  const waiting = item.status === "waiting";
  const recipient = reviseRecipient(item);

  function move(step: number) {
    const next = index + step;
    if (next < 0 || next > previews.length - 1) return;
    onIndex(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); move(1); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        unstyled
        showCloseButton={false}
        className="r22-approvals-layer"
        overlayClassName="r22-approvals-scrim"
        onKeyDown={handleKeyDown}
      >
        <div className="r22-approvals-stage">
          <figure className={`r22-approvals-frame ${ratioClass(preview.ratio ?? "4:5")}${preview.image ? "" : " is-pending"}`}>
            {preview.image ? <ApprovalThumb src={preview.image} className="r22-approvals-frame-img" /> : <span>Not made yet</span>}
          </figure>
          {previews.length > 1 ? (
            <div className="r22-approvals-strip">
              {previews.map((entry, entryIndex) => (
                <Button
                  unstyled
                  type="button"
                  key={`${item.id}-strip-${entryIndex}`}
                  aria-current={entryIndex === index}
                  aria-label={`Show ${entry.platform}${entry.slot ? ` ${entry.slot}` : ""}`}
                  onClick={() => onIndex(entryIndex)}
                >
                  {entry.image ? <ApprovalThumb src={entry.image} className="r22-approvals-frame-img" /> : null}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="r22-approvals-side">
          <p className="r22-approvals-lmeta">
            <span className="r22-approvals-chico" aria-hidden="true">{item.channel === "facebook" ? <Megaphone /> : <Camera />}</span>
            <span>{preview.platform}</span>
            {preview.slot ? <><i className="r22-approvals-sep">·</i><time>{preview.slot}</time></> : null}
          </p>
          <DialogTitle className="r22-approvals-lcap">{preview.caption}</DialogTitle>
          {item.note ? <p className="r22-approvals-lnote">{item.note}</p> : null}
          <DialogDescription className="r22-approvals-lfit">{preview.fit}</DialogDescription>
          {item.blocker ? (
            <p className="r22-approvals-lblock"><TriangleAlert aria-hidden="true" />{item.blocker.chip}. {item.blocker.why}</p>
          ) : null}

          <p className="r22-approvals-lask">{waiting ? item.ask ?? "Approve this post?" : "Already decided"}</p>
          <p className="r22-approvals-lconseq">{waiting ? item.consequence : item.decision}</p>
          {waiting ? (
            <div className="r22-approvals-lacts">
              <Button unstyled type="button" disabled={blocked} onClick={() => { onClose(); onApprove(item); }}>Approve{creditSuffix(item.cost)}</Button>
              <Button unstyled type="button" onClick={() => { onClose(); onBegin(item, "revise"); }}>Ask {recipient} to revise</Button>
              <Button unstyled type="button" onClick={() => { onClose(); onBegin(item, "reject"); }}>Reject</Button>
            </div>
          ) : null}
        </div>

        <DialogClose className="r22-approvals-layer-x" aria-label="Close the preview">
          <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export default ApprovalLayer;
