"use client";

/**
 * 北极星 · 极简真首页(#609 · 2026-08-02 Founder 裁决「Create home 砍,Home = 极简真首页」)。
 *
 * 三样东西,一样不多:
 *   ① 开工输入框 —— 写下要做的东西,按下就**真的**开一张新画布(名字就是写的那句话),
 *      直接落在那张画布上。留空也能开,名字退回 "New canvas"。
 *   ② 新建画布按钮 —— 与①同一条真路径(createProject → 跳该项目的画布)。
 *   ③ 真项目列表 —— 商家自己的画布,按认证身份读(见 NorthstarHomeEntry),点开即进。
 *
 * 这一页没有样板数据:没有余额、没有「今日决策队列」、没有编造的经营事实。空账号看到的就是
 * 空的 —— 那是诚实的空,不是假的满。
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Plus } from "lucide-react";
import { CANVAS_HREF } from "@fikirtive/core/navigation";
import { createProject } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export interface NorthstarHomeProject {
  id: string;
  name: string;
  updatedAt: string;
}

export function canvasHref(projectId: string): string {
  return `${CANVAS_HREF}?project=${encodeURIComponent(projectId)}`;
}

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

export function NorthstarHome({ projects }: { projects: NorthstarHomeProject[] }) {
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
    <div className="mx-auto w-full max-w-[720px] px-6 py-10">
      <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] text-foreground">
        What are we making?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Write it down and we&apos;ll open a canvas for it. Nothing is charged until you press
        Generate on the canvas.
      </p>

      {/* ① 开工输入框 + ② 新建画布 —— 同一条真路径 */}
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          startCanvas(draft);
        }}
      >
        <div className="flex items-center gap-2 rounded-[16px] border border-input bg-card p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Raya promo for the croffle set"
            aria-label="What are we making?"
            maxLength={120}
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[14px] leading-[20px] text-foreground outline-none placeholder:text-muted-foreground"
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
            onClick={() => startCanvas("")}
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

      {/* ③ 真项目列表 */}
      <h2 className="mt-10 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        Your canvases
      </h2>
      {projects.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing here yet. Your first canvas shows up the moment you start one.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={canvasHref(project.id)}
                className="flex min-h-11 items-center gap-3 rounded-[12px] px-3 py-2 text-[14px] transition-colors duration-[120ms] hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{project.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatUpdated(project.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default NorthstarHome;
