/**
 * Home(`/`)的等待态。
 *
 * 这一版之前画的是**换壳以前**的 Home:一个 `max-w-5xl mx-auto` 的居中窄栏,里面一行问候、
 * 一个开工框、一列画布磁贴。真正的 R22 Home 早就不是那个形状了 —— 它是 `.r22-home`,
 * 左对齐满宽、`padding: 38px 48px 18px`,底下是一张两栏的连接卡、一副两栏的洞察网格、
 * 两条横排。骨架与落定之间因此整屏跳一次:内容从居中的 1024px 栏跳到满宽的 48px 内边距,
 * 纵向节奏也对不上。骨架画错形状比没有骨架更吵。
 *
 * 修法不是「照着量一遍再抄一份尺寸」—— 那样两边还会各自漂移。这里直接**复用真页面的那些
 * class**:`.r22-home`、`.r22-home-header`、`.r22-home-connect-card`、
 * `.r22-home-insight-grid`……容器的内边距、栏宽、min-height、圆角与边框全部由同一份 CSS
 * 出,几何上不可能对不上。灰块只填文字的位置,卡片的轮廓在第一帧就落在最终位置上。
 *
 * `data-r22-skeleton` 关掉 `ui/skeleton` 自带的 `animate-pulse`(见 r22-dashboard.css):
 * 原型的原话是「骨架只活 450ms,动效预算不许任何东西循环。告诉商家有张卡要来的是形状,
 * 不是闪」。骨架零入场动画,内容落定时做一次 140ms 的淡入,不做「骨架闪→白闪→内容」。
 *
 * 同一条纪律决定了它住在 `(home)` 路由组里而不是 `app/` 根上:根上的 `loading.tsx` 是
 * **整个 app** 的 Suspense 边界,这一屏 Home 形状会照着盖到 /billing、/create、/login……
 * 每一条没有自己等待态的路由上去。路由组不进地址,所以 `/` 一个字都没变。
 */

import { Skeleton } from "@/components/ui/skeleton";
import "@/components/home/r22-home.css";

export default function HomeLoading() {
  return (
    <div className="r22-home" data-r22-skeleton role="status" aria-busy="true">
      <header className="r22-home-header">
        <div>
          {/* h1 是 26px/1.2,副标题 13px */}
          <Skeleton className="h-[31px] w-[264px] rounded-[8px]" />
          <Skeleton className="mt-[9px] h-[16px] w-[332px] rounded-[6px]" />
        </div>
      </header>

      <section className="r22-home-connect-card">
        <div className="r22-home-connect-copy">
          <Skeleton className="h-[19px] w-[196px] rounded-[6px]" />
          <Skeleton className="mt-[6px] h-[15px] w-full max-w-[380px] rounded-[6px]" />
          <div className="r22-home-channels">
            {[0, 1, 2, 3].map((row) => (
              <div className="r22-home-channel" key={row}>
                <Skeleton className="h-[18px] w-[18px] rounded-[5px]" />
                <Skeleton className="h-[14px] w-[92px] rounded-[6px]" />
                <Skeleton className="ml-auto h-[30px] w-[84px] rounded-[8px]" />
              </div>
            ))}
          </div>
        </div>

        <ol className="r22-home-connection-steps">
          {[0, 1, 2, 3].map((step) => (
            <li key={step}>
              <Skeleton className="h-[18px] w-[18px] rounded-full" />
              <div>
                <Skeleton className="h-[14px] w-[104px] rounded-[6px]" />
                <Skeleton className="mt-[6px] h-[12px] w-[176px] rounded-[6px]" />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="r22-home-insight-grid">
        <section className="r22-home-performance">
          <Skeleton className="h-[19px] w-[112px] rounded-[6px]" />
          <Skeleton className="mt-[15px] h-[202px] w-full rounded-[10px]" />
        </section>
        <section className="r22-home-analysis">
          <Skeleton className="h-[19px] w-[168px] rounded-[6px]" />
          <ul>
            {[0, 1, 2].map((item) => (
              <li key={item}>
                <Skeleton className="h-[28px] w-[28px] rounded-[8px]" />
                <div>
                  <Skeleton className="h-[13px] w-[116px] rounded-[6px]" />
                  <Skeleton className="mt-[5px] h-[11px] w-[228px] rounded-[6px]" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="r22-home-create-row">
        <Skeleton className="h-[38px] w-[38px] shrink-0 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-[14px] w-[152px] rounded-[6px]" />
          <Skeleton className="mt-[5px] h-[12px] w-full max-w-[420px] rounded-[6px]" />
        </div>
        <Skeleton className="h-[32px] w-[96px] shrink-0 rounded-[8px]" />
      </section>

      <section className="r22-home-context-row">
        <Skeleton className="h-[16px] w-[16px] shrink-0 rounded-[4px]" />
        <div className="flex-1">
          <Skeleton className="h-[13px] w-[288px] rounded-[6px]" />
          <Skeleton className="mt-[5px] h-[11px] w-[336px] rounded-[6px]" />
        </div>
        <Skeleton className="h-[14px] w-[124px] shrink-0 rounded-[6px]" />
      </section>

      <span className="sr-only">Loading your home</span>
    </div>
  );
}
