"use client";

/**
 * Create's single production entry. One submit atomically creates one Canvas, one empty
 * Conversation and a durable first-turn handoff; Canvas then sends that exact prompt through the
 * existing Otto stream. The browser UUID is held across a retry so an uncertain response cannot
 * duplicate the merchant's work.
 *
 * FRONT §7.1 ⑨ (`docs/specs/frontend-baseline.md`): the geometry, copy and control set here are
 * the approved entry-surface composer — `design-system/patterns/canvas/CreationComposer.tsx`
 * rendered with `surface="entry"`. Every class string below is copied from that pattern verbatim
 * so the two cannot drift silently (`create-design-parity.test.ts` compares them line by line).
 *
 * Two deliberate departures, both Founder rules from the same ruling:
 *   ① 设计有、后端没有契约的控件不渲染 — the pattern's "Add context" reference menu (Upload image /
 *      Choose from Library / Add URL) is fixture-only: it sets a display string and nothing is
 *      persisted. `createCanvasConversation` takes `{prompt, requestId}` and the handoff row stores
 *      `{prompt, threadId}`, so there is no contract to carry a reference from this page into the
 *      Canvas. The control stays out; with the left group gone the control row is `justify-end` and
 *      the send key keeps its position. This is already on the record in the frozen spec: `docs/
 *      specs/frontend-baseline.md` §5, row 2026-09-03「⑨ 段下一刀「起步页参考契约」」, with the
 *      wiring and estimate in §7.3「⑨ 下一刀 · 起步页参考契约」. The PR's 「设计有、生产暂不显示」
 *      table mirrors those two; this PR changes no spec file.
 *   ② 生产必需而设计没有的用设计的样式呈现 — the error and pending states (Field / FieldError /
 *      Spinner) are production-necessary and use the design system's own primitives, no new copy.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpIcon } from "lucide-react";
import { createCanvasConversation } from "@/lib/canvas-entry-actions";
import { canvasHref } from "@/components/canvas/canvas-href";
import { ConversationCostHint } from "@/components/otto/ConversationCostHint";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

export function StartSomething() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestIdRef = useRef<string | null>(null);

  function startCanvas(prompt: string) {
    if (pending) return;
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Describe what you want to create.");
      return;
    }
    setError(null);
    startTransition(async () => {
      requestIdRef.current ??= crypto.randomUUID();
      const result = await createCanvasConversation({ prompt: trimmed, requestId: requestIdRef.current });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(canvasHref(result.projectId, {
        threadId: result.threadId,
        handoffId: result.handoffId,
      }));
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startCanvas(draft);
      }}
    >
      <Field data-invalid={Boolean(error)}>
        <InputGroup className="flex-col items-stretch rounded-[var(--radius-card)] bg-background p-2">
          <InputGroupTextarea
            aria-label="Otto creation prompt"
            className="w-full px-2.5 py-2 text-base leading-6 min-h-[78px]"
            placeholder="Describe an image or video to create"
            value={draft}
            aria-invalid={Boolean(error)}
            maxLength={4000}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.trim()) {
                event.preventDefault();
                startCanvas(draft);
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="submit"
              aria-label="Send prompt"
              disabled={pending || !draft.trim()}
              size="icon-sm"
              variant="otto"
            >
              {pending ? <Spinner aria-label="Starting Canvas" /> : <ArrowUpIcon />}
            </Button>
          </div>
        </InputGroup>
        <FieldError>{error}</FieldError>
      </Field>
      {/* 披露先于扣费(Founder 2026-09-05 裁决②「输入框下加一行价钱」;登记在
          `docs/specs/frontend-baseline.md` §5)。按一下这个发送键就在同一笔事务里开一条
          `surface="canvas"` 的对话,画布挂载即把这第一轮送出去 —— 那一轮**本身按用量计费**,
          而这条路径此前从按下到扣钱全程零披露。挂的是画布与门厅用的**同一个**组件,不是
          第二份价目:数值只有 `lib/credit-format.ts` 一处作者,这份文件里一个钱数都不写。
          裁决五删掉的「Create with Otto」标题行与「Nothing paid starts…」那句不恢复 ——
          松开的只有「这一页不出现价钱」这一格。 */}
      <div className="mt-2 flex">
        <ConversationCostHint />
      </div>
    </form>
  );
}

export default StartSomething;
