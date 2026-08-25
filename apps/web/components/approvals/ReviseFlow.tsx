"use client";

/**
 * ReviseFlow.tsx —— ① 三态动作里的后两态,共用一张理由表。
 *
 * 两种模式,同一块面板,差别是明写的:
 *   · **revise** —— 理由必填,提交之后走版本循环(④):这一条进 Sent back 并被新版本取代,
 *     新版本带着 What changed 与「已结清」的旧意见回到 Needs review。
 *   · **reject** —— 终局。理由可留可不留,**不触发重做**,没有下一个版本。
 *
 * 旧的「Send back」把这两件事混成一个按钮:商家点下去之后既不知道要不要等新版本,
 * 也没法表达「这条我不要了」。拆开之后每个按钮只承诺一件事。
 */

import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

import { REASONS } from "./approvals-fixture";

export type ReviseMode = "revise" | "reject";

export function ReviseFlow({
  mode,
  count,
  recipient,
  reason,
  note,
  busy,
  onReason,
  onNote,
  onSubmit,
  onCancel,
}: {
  mode: ReviseMode;
  count: number;
  recipient: string;
  reason: string;
  note: string;
  busy: boolean;
  onReason: (reason: string) => void;
  onNote: (note: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const many = count > 1;
  const heading = mode === "revise"
    ? many ? `What should ${recipient} change on ${count} items?` : `What should ${recipient} change?`
    : many ? `Why reject ${count} items?` : "Why reject this?";
  const lead = mode === "revise"
    ? `Pick one reason. ${recipient} uses it for the next version.`
    : "Pick a reason if you want one. Nothing is remade, and no new version comes back.";
  const submitLabel = mode === "revise" ? `Ask ${recipient} to revise` : "Reject";
  const notePlaceholder = mode === "revise"
    ? `What should ${recipient} change? Optional.`
    : "Anything you want on the record? Optional.";

  return (
    <div className="r22-approvals-reject" role="group" aria-label={heading} data-mode={mode}>
      <h3>{heading}</h3>
      <p>{lead}</p>
      <RadioGroup unstyled value={reason} onValueChange={onReason} aria-label={mode === "revise" ? "Reason for the revise" : "Reason for rejecting"}>
        {REASONS.map((label) => (
          <label key={label}>
            <RadioGroupItem unstyled className="r22-approvals-radio" value={label} />
            {label}
          </label>
        ))}
      </RadioGroup>
      <Textarea
        unstyled
        rows={2}
        value={note}
        aria-label={notePlaceholder}
        onChange={(event) => onNote(event.target.value)}
        placeholder={notePlaceholder}
      />
      <div>
        <Button unstyled type="button" disabled={busy || (mode === "revise" && !reason)} onClick={onSubmit}>{submitLabel}</Button>
        <Button unstyled type="button" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default ReviseFlow;
