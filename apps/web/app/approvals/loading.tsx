/**
 * `/approvals` 的等待画面 —— 此前**整个不存在**。
 *
 * `ApprovalsPage` 是 `async` 的 Server Component,开头就 `await requireOwner()` 再读队列。
 * 没有 `loading.tsx` 的时候,那一整段服务端时间里 App Router 连路由都不 commit:侧栏高亮
 * 不动、屏幕不换、商家按下 Approvals 之后看不到任何回应。
 *
 * 骨架复用真页面的 `.r22-approvals`(1020px 定宽、`max-width: calc(100% - 96px)`、居中、
 * `padding: 40px 48px 72px`),所以那一栏在第一帧就落在最终位置上,内容到了不横跳。
 */

import { Skeleton } from "@/components/ui/skeleton";
import "@/components/approvals/r22-approvals.css";

export default function ApprovalsLoading() {
  return (
    <div className="r22-approvals" data-r22-skeleton role="status" aria-busy="true">
      <header>
        <Skeleton className="h-[26px] w-[168px] rounded-[8px]" />
        <Skeleton className="mt-[8px] h-[17px] w-[416px] max-w-full rounded-[6px]" />
      </header>

      <div className="r22-approvals-banner">
        <Skeleton className="h-[15px] w-[15px] shrink-0 rounded-[4px]" />
        <Skeleton className="h-[13px] w-[368px] max-w-full rounded-[6px]" />
      </div>

      <div className="r22-approvals-fact">
        <Skeleton className="h-[15px] w-[292px] max-w-full rounded-[6px]" />
        <Skeleton className="h-[30px] w-[124px] shrink-0 rounded-[8px]" />
      </div>

      <div className="r22-approvals-bar">
        <div className="flex gap-[4px]">
          <Skeleton className="mb-[9px] mt-[9px] h-[18px] w-[92px] rounded-[6px]" />
          <Skeleton className="mb-[9px] mt-[9px] h-[18px] w-[84px] rounded-[6px]" />
          <Skeleton className="mb-[9px] mt-[9px] h-[18px] w-[76px] rounded-[6px]" />
        </div>
        <div className="flex gap-[6px] pb-[7px]">
          <Skeleton className="h-[23px] w-[64px] rounded-full" />
          <Skeleton className="h-[23px] w-[72px] rounded-full" />
        </div>
      </div>

      <div className="r22-approvals-list">
        {[0, 1].map((group) => (
          <div className="r22-approvals-group" key={group}>
            <header>
              <Skeleton className="h-[16px] w-[136px] rounded-[6px]" />
              <Skeleton className="h-[14px] w-[72px] rounded-[6px]" />
            </header>
            {[0, 1, 2].map((row) => (
              <div
                className="mt-[10px] flex items-center gap-[14px] rounded-[12px] border border-[var(--r22-line)] bg-[var(--r22-surface)] p-[14px]"
                key={row}
              >
                <Skeleton className="h-[64px] w-[64px] shrink-0 rounded-[9px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-[14px] w-[212px] max-w-full rounded-[6px]" />
                  <Skeleton className="mt-[6px] h-[12px] w-[324px] max-w-full rounded-[6px]" />
                  <Skeleton className="mt-[6px] h-[12px] w-[164px] max-w-full rounded-[6px]" />
                </div>
                <Skeleton className="h-[30px] w-[88px] shrink-0 rounded-[8px]" />
                <Skeleton className="h-[30px] w-[88px] shrink-0 rounded-[8px]" />
              </div>
            ))}
          </div>
        ))}
      </div>

      <span className="sr-only">Loading approvals</span>
    </div>
  );
}
