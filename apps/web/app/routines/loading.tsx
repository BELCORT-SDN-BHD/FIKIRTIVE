/**
 * `/routines` 的等待画面 —— 此前**整个不存在**。
 *
 * 和 `/create`、`/approvals` 同一个病:`force-dynamic` 的 Server Component,读完才吐字节,
 * 中间那一段商家按下去没有任何回应。
 *
 * 骨架复用 `.r22-routines`(宽度与内边距跟着 `--r22-content-width` / `--r22-content-gutter`
 * 两个 token 走)与 `.r22-routine-card`,所以卡片的边框、圆角与行距在第一帧就对上。
 */

import { Skeleton } from "@/components/ui/skeleton";
import "@/components/routines/r22-routines.css";

export default function RoutinesLoading() {
  return (
    <div className="r22-routines" data-r22-skeleton role="status" aria-busy="true">
      <div className="r22-routines-head">
        <div>
          <Skeleton className="h-[26px] w-[132px] rounded-[8px]" />
          <Skeleton className="mt-[8px] h-[17px] w-[396px] max-w-full rounded-[6px]" />
        </div>
        <Skeleton className="h-[34px] w-[124px] shrink-0 rounded-[8px]" />
      </div>

      <div className="r22-routine-tabs">
        <Skeleton className="mb-[10px] h-[16px] w-[68px] rounded-[6px]" />
        <Skeleton className="mb-[10px] h-[16px] w-[80px] rounded-[6px]" />
      </div>

      <Skeleton className="mt-[10px] h-[15px] w-[452px] max-w-full rounded-[6px]" />

      {[0, 1, 2].map((card) => (
        <div className="r22-routine-card" key={card}>
          <header>
            <Skeleton className="h-[16px] w-[188px] rounded-[6px]" />
            <div className="flex gap-[6px]">
              <Skeleton className="h-[20px] w-[64px] rounded-full" />
              <Skeleton className="h-[20px] w-[72px] rounded-full" />
            </div>
          </header>
          <Skeleton className="mt-[10px] h-[16px] w-[248px] rounded-[6px]" />
          <Skeleton className="mt-[7px] h-[13px] w-[356px] max-w-full rounded-[6px]" />
          <div className="r22-routine-progress">
            <Skeleton className="h-[13px] w-[76px] rounded-[6px]" />
            <Skeleton className="h-[5px] w-[190px] rounded-full" />
            <Skeleton className="h-[13px] w-[64px] rounded-[6px]" />
          </div>
          <footer>
            <Skeleton className="h-[28px] w-[76px] rounded-[7px]" />
            <Skeleton className="h-[28px] w-[92px] rounded-[7px]" />
            <Skeleton className="ml-auto h-[13px] w-[120px] rounded-[6px]" />
          </footer>
        </div>
      ))}

      <span className="sr-only">Loading your routines</span>
    </div>
  );
}
