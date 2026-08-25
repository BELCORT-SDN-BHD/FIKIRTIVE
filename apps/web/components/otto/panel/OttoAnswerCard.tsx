"use client";

/**
 * OttoAnswerCard.tsx —— Otto 回话的那张卡(原型 `answerHTML`,L6704-6706)。
 *
 * 一张卡 = 标题 + 导语 + 要点 + 一句诚实注脚 + 一排动作 + 一处 `aria-live` 回执。
 * 内容从 `otto-answer.ts` 的 `responseFor()` 来,这个文件只负责把它画出来、把那四颗按钮
 * 接上真行为。
 *
 * 四颗按钮里只有 Copy 会真的对外做事(写剪贴板),另外三颗**只改这张卡自己的状态**:
 *   · Helpful / Not helpful —— 记在这张卡上,`aria-pressed` 翻转。它不往任何地方发送,
 *     所以回执也不许写成「已提交」;
 *   · Get support —— 是一条通往 `/help` 的真链接,不是一颗按了没反应的按钮。点它同时
 *     把「一条消息都没发出去」这件事说出来。
 *
 * 动效(Emil):卡入场是 opacity + 8px 上移的一次 `ease-out`(CSS 那侧 180ms,
 * `prefers-reduced-motion` 下只剩淡入、零位移),按钮按下 `scale(.97)`。没有 `scale(0)`。
 */

import * as React from "react";
import Link from "next/link";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { Button } from "@/components/ui/button";
import {
  OTTO_ANSWER_CONFIRM,
  ottoAnswerCopyText,
  type OttoAnswer,
} from "./otto-answer";

export interface OttoAnswerCardProps {
  answer: OttoAnswer;
  /** 这张卡在会话里的身份 —— 测试与 DOM 查询用它认人,不进商家读得到的字。 */
  answerId: string;
}

type Feedback = "up" | "down" | null;

export function OttoAnswerCard({ answer, answerId }: OttoAnswerCardProps) {
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [confirm, setConfirm] = React.useState("");

  const copyText = ottoAnswerCopyText(answer);

  function copy() {
    // 剪贴板在不安全上下文 / 无权限时会拒绝。拒绝了就不说 "Copied" —— 那句话是回执,
    // 不是装饰。
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) return;
    void clipboard.writeText(copyText).then(
      () => setConfirm(OTTO_ANSWER_CONFIRM.copied),
      () => setConfirm(""),
    );
  }

  function mark(next: Exclude<Feedback, null>) {
    setFeedback(next);
    setConfirm(next === "up" ? OTTO_ANSWER_CONFIRM.helpful : OTTO_ANSWER_CONFIRM.notHelpful);
  }

  return (
    <div data-otto-answer={answerId} className="r22-otto-answer">
      <h3>{answer.title}</h3>
      <p>{answer.lead}</p>
      <ul>
        {answer.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <p data-otto-answer-fact="" className="r22-otto-answer-fact">{answer.note}</p>
      <div className="r22-otto-answer-actions">
        <Button unstyled type="button" data-otto-answer-copy="" onClick={copy}>
          Copy
        </Button>
        <Button
          unstyled
          type="button"
          data-otto-answer-feedback="up"
          aria-pressed={feedback === "up"}
          data-selected={feedback === "up" ? "" : undefined}
          onClick={() => mark("up")}
        >
          Helpful
        </Button>
        <Button
          unstyled
          type="button"
          data-otto-answer-feedback="down"
          aria-pressed={feedback === "down"}
          data-selected={feedback === "down" ? "" : undefined}
          onClick={() => mark("down")}
        >
          Not helpful
        </Button>
        <Link
          data-otto-answer-support=""
          href={SHELL_ROUTES.help}
          onClick={() => setConfirm(OTTO_ANSWER_CONFIRM.support)}
        >
          Get support
        </Link>
      </div>
      <span data-otto-answer-confirm="" className="r22-otto-answer-confirm" role="status" aria-live="polite">
        {confirm}
      </span>
    </div>
  );
}
