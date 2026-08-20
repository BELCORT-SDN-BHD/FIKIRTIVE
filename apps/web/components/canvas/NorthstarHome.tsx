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
 * ①②现在是共享组件 `<StartSomething/>`(换壳规格书 Q2-A):Home 与 Create 摆的是同一个框、
 * 同一条动作,不是两个长得像的框。这里只剩「这一页的标题」与③。
 *
 * 这一页没有样板数据:没有余额、没有「今日决策队列」、没有编造的经营事实。空账号看到的就是
 * 空的 —— 那是诚实的空,不是假的满。
 */

import Link from "next/link";
import { canvasHref } from "@/components/canvas/canvas-href";
import { StartSomething } from "@/components/start-something/StartSomething";

export interface NorthstarHomeProject {
  id: string;
  name: string;
  /**
   * Pre-formatted on the server (NorthstarHomeEntry), not a raw timestamp — this is a
   * client component, so React renders it once on the server and again in the browser
   * during hydration. `toLocaleDateString` used to run here on both sides, and Node's
   * ICU data doesn't always agree with the browser's for the same locale, which trips
   * a hydration mismatch (#949 A5). Formatting it once, server-side, and shipping the
   * finished string removes the second computation entirely, so there's nothing left
   * to disagree with.
   */
  updatedLabel: string;
}

export function NorthstarHome({ projects }: { projects: NorthstarHomeProject[] }) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-10">
      <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] text-foreground">
        What are we making?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Write it down and we&apos;ll open a canvas for it. Nothing is charged until you press
        Generate on the canvas.
      </p>

      {/* ① 开工输入框 + ② 新建画布 —— 同一条真路径,与 Home 摆的是同一个组件 */}
      <div className="mt-6">
        <StartSomething />
      </div>

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
                  {project.updatedLabel}
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
