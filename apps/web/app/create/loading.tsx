/**
 * `/create`(Canvas projects)的等待画面 —— 此前**整个不存在**。
 *
 * 这一页是 `force-dynamic` 的 Server Component:要先读完项目列表才吐第一个字节。没有
 * `loading.tsx` 的时候,商家在侧栏按下 Canvas 之后,屏幕上一动不动地停在上一页,直到
 * 服务端全部读完才整屏换掉 —— 那一整段里,产品看起来像没收到那一下。
 *
 * 骨架复用真页面的 class(`.r22-projects`、`.r22-projects-table`、`.r22-projects-row`),
 * 所以内边距、栏宽、行高、圆角全部由同一份 CSS 出,落定时不会跳。`data-r22-skeleton`
 * 关掉 `animate-pulse`(理由见 r22-dashboard.css 的「换屏:等待态的动效预算」)。
 */

import { Skeleton } from "@/components/ui/skeleton";
import "@/components/projects/r22-projects.css";

export default function CreateLoading() {
  return (
    <div className="r22-projects" data-r22-skeleton role="status" aria-busy="true">
      <div className="r22-projects-breadcrumb">
        <Skeleton className="h-[14px] w-[64px] rounded-[6px]" />
        <Skeleton className="h-[14px] w-[92px] rounded-[6px]" />
      </div>

      <div className="mt-[20px]">
        <Skeleton className="h-[28px] w-[236px] rounded-[8px]" />
      </div>
      <Skeleton className="mt-[9px] h-[16px] w-[404px] max-w-full rounded-[6px]" />

      <div className="r22-projects-tabs">
        <Skeleton className="mb-[12px] h-[16px] w-[76px] rounded-[6px]" />
        <Skeleton className="mb-[12px] h-[16px] w-[68px] rounded-[6px]" />
        <Skeleton className="mb-[12px] h-[16px] w-[84px] rounded-[6px]" />
      </div>

      <div className="r22-projects-toolbar">
        <Skeleton className="h-[38px] w-[260px] shrink-0 rounded-[8px]" />
        <Skeleton className="ml-auto h-[38px] w-[132px] shrink-0 rounded-[8px]" />
      </div>

      <div className="r22-projects-table">
        <div className="r22-projects-row r22-projects-head">
          <Skeleton className="h-[9px] w-[68px] rounded-[4px]" />
          <Skeleton className="h-[9px] w-[52px] rounded-[4px]" />
          <Skeleton className="h-[9px] w-[60px] rounded-[4px]" />
          <Skeleton className="h-[9px] w-[44px] rounded-[4px]" />
          <span />
        </div>
        {[0, 1, 2, 3, 4].map((row) => (
          <div className="r22-projects-row" key={row}>
            <div className="flex items-center gap-[12px]">
              <Skeleton className="h-[38px] w-[38px] shrink-0 rounded-[9px]" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-[13px] w-[168px] max-w-full rounded-[6px]" />
                <Skeleton className="mt-[5px] h-[11px] w-[112px] max-w-full rounded-[6px]" />
              </div>
            </div>
            <Skeleton className="h-[13px] w-[96px] rounded-[6px]" />
            <Skeleton className="h-[13px] w-[104px] rounded-[6px]" />
            <Skeleton className="h-[13px] w-[72px] rounded-[6px]" />
            <Skeleton className="h-[16px] w-[16px] rounded-[5px]" />
          </div>
        ))}
      </div>

      <span className="sr-only">Loading your canvas projects</span>
    </div>
  );
}
