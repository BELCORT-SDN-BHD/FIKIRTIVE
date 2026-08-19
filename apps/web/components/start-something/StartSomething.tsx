"use client";

/**
 * 「开始做点什么」—— **一份实现,一条动作**(换壳规格书 `docs/specs/wave2-shell.md` Q2-A,
 * Founder 2026-08-18 拍板)。
 *
 * `ia.json` 记录的头号重叠就是两个平行前门:Otto 聊天框与画布输入框,两套心智模型。裁决的
 * 收口办法不是「少摆一个」,而是「同一个框摆两处」—— 所以这里没有任何 prop:摆在 Home 上的
 * 那一个和摆在 Create 上的那一个,是同一段代码、同一句话、同一条动作
 * (`createProject(name)` → 直接落在那张画布上)。谁想给某一处换句文案,改的就是两处,
 * 那正是我们要的:它们本来就该说同一句话。
 *
 * 中立命名与中立位置(`components/start-something/`)是刻意的:它既不属于 Home 也不属于
 * Create。W2-5(Create 改名搬家)接手 `/create` 时直接复用这一份,不再建第二份。
 *
 * Otto 面板**永远不静默开画布** —— 它只提议,商家点了才建。这条纪律不在这里执行(这里根本
 * 不认识 Otto),但它是这个组件存在的理由之一。
 *
 * 说清楚范围:这是**新壳面**上开画布的唯一入口(Home 与 Create 都是它)。旧壳里还有一处
 * `createProject` —— `components/otto/OttoApp.tsx:401` 的 "New project",那是旧 `/otto` 宿主
 * 自己的按钮,Q5-A 已裁定不留旧全屏页,它随 W2-11 一并退场。这一票不动它。
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Plus } from "lucide-react";
import { createProject } from "@/lib/actions";
import { canvasHref } from "@/components/canvas/canvas-href";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function StartSomething() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startCanvas(name: string) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createProject(name);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(canvasHref(result.id));
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startCanvas(draft);
      }}
    >
      <div className="flex items-center gap-2 rounded-[16px] border border-input bg-card p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
        {/* #840 车4:迁到 ui/Input。这一枚是「裸嵌在一个自绘边框壳里」的输入 —— 边框、
            背景与焦点环由外面那层 div 的 `focus-within:` 画,所以组件自带的边框/背景/
            阴影/高度/圆角在这里全是重复,逐条压回原来的裸态(`h-auto`/`rounded-none`/
            `border-0`/`bg-transparent`/`shadow-none`),内距与字号保持原值。焦点环也压掉
            (`focus-visible:ring-0`):外壳已经画了一圈,组件再画一圈就是两圈。 */}
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Raya promo for the croffle set"
          aria-label="What are we making?"
          maxLength={120}
          className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 py-1.5 text-[14px] leading-[20px] text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Open a canvas for this"
          className="size-8 shrink-0 rounded-full"
          disabled={pending}
        >
          <ArrowUp strokeWidth={2.5} />
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => startCanvas(draft)}
          disabled={pending}
        >
          <Plus strokeWidth={2.5} />
          New canvas
        </Button>
        <span className="text-xs text-muted-foreground">
          The canvas is named after what you wrote — you can rename it later.
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-error-soft-foreground">
          {error}
        </p>
      )}
    </form>
  );
}

export default StartSomething;
