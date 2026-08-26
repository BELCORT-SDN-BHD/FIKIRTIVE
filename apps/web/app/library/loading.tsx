/**
 * Library 的加载态(规格书 §5.6:新路由的 loading 一律走 `ui/skeleton`,不手搓)。
 *
 * 上一版画的是一栏 880px、六个方块的「陈列柜」—— 那是 Library 被重建成工作台**之前**的
 * 形状。落定页早已是 `.r22-lib` 的 168px + 1fr 双栏(左边一条薄导航,右边工具排 + 按日
 * 分组的六列网格),两个形状对不上,商家看到的就是内容一到整页跳一下。骨架画错形状比
 * 没有骨架更吵 —— 这是仓库法,也是这一版重画的全部理由。
 *
 * 所以这里复用真页面的 class(`.r22-library`、`.r22-lib`、`.r22-lib-nav`、`.r22-lib-main`、
 * `.r22-lib-tools`、`.r22-lib-groups`、`.r22-lib-grid`、`.r22-lib-tile`),内边距、栏宽、
 * 行高、圆角全部由 `components/library/r22-library.css` 这一份出,落定时不会跳。配方照
 * `app/create/loading.tsx`:容器借真 class,叶子用固定 px 的 `Skeleton`。
 * `data-r22-skeleton` 关掉 `animate-pulse`(理由见 r22-dashboard.css 的「换屏:等待态的动效预算」)。
 */

import { Skeleton } from "@/components/ui/skeleton";
import "@/components/library/r22-library.css";

export default function LibraryLoading() {
  return (
    <main className="r22-library" data-r22-skeleton role="status" aria-busy="true">
      <header>
        <Skeleton className="h-[26px] w-[86px] rounded-[8px]" />
        <Skeleton className="mt-[9px] h-[15px] w-[300px] max-w-full rounded-[6px]" />
      </header>

      <div className="r22-lib">
        <nav className="r22-lib-nav">
          <ul>
            {[0, 1, 2, 3].map((row) => (
              <li key={row}>
                <Skeleton className="h-[30px] w-full rounded-[8px]" />
              </li>
            ))}
          </ul>

          <p className="r22-lib-nav-h">
            <Skeleton className="h-[9px] w-[64px] rounded-[4px]" />
          </p>
          <ul>
            {[0, 1].map((row) => (
              <li key={row}>
                <Skeleton className="h-[30px] w-full rounded-[8px]" />
              </li>
            ))}
          </ul>
        </nav>

        <div className="r22-lib-main">
          <div className="r22-lib-tools">
            <span className="r22-lib-search">
              <Skeleton className="h-[32px] w-full rounded-[8px]" />
            </span>
            <Skeleton className="h-[29px] w-[152px] shrink-0 rounded-[9px]" />
            <Skeleton className="h-[29px] w-[138px] shrink-0 rounded-[9px]" />
            <Skeleton className="h-[29px] w-[62px] shrink-0 rounded-[9px]" />
            <Skeleton className="h-[30px] w-[86px] shrink-0 rounded-[8px]" />
            <Skeleton className="h-[30px] w-[92px] shrink-0 rounded-[8px]" />
          </div>

          <div className="r22-lib-groups">
            {[0, 1].map((group) => (
              <section className="r22-lib-group" key={group}>
                <h3>
                  <Skeleton className="h-[9px] w-[72px] rounded-[4px]" />
                </h3>
                <div className="r22-lib-grid">
                  {[0, 1, 2, 3, 4, 5].map((tile) => (
                    <div className="r22-lib-tile" key={tile}>
                      <Skeleton className="block aspect-[4/5] w-full rounded-none" />
                      <span className="r22-lib-meta">
                        <Skeleton className="h-[11px] w-[74%] rounded-[5px]" />
                        <Skeleton className="mt-[3px] h-[9px] w-[48%] rounded-[4px]" />
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      <span className="sr-only">Loading your Library</span>
    </main>
  );
}
