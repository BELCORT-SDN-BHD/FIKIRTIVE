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
 * Home 收尾(Founder 2026-08-25 批的样张)之后,落定页的连接卡换了形状:connect-first 态
 * 不再是两栏 grid(旧竖排时间线占右栏),而是 `.is-connect-first` 单卡 —— 标题、渠道四行、
 * 一行步进器(`.r22-home-stepper`)、Skip for now,四段纵向堆叠。这份骨架跟着换:
 * 单卡(标题条 + 四行 + 一细行 + 一短行)、下方一卡(Performance 独占整行)、create 行
 * (图标 + 单行标题 + 三个动作占位)。旧版画的竖排 `<ol><li>` 时间线、裸 `<ul><li>` 分析
 * 列表、`.r22-home-context-row` 整块占位都不在落定页上了,骨架也跟着退场 —— 那几条 CSS
 * 已经删掉。
 *
 * 「Otto will analyse」那张卡 2026-08-26 整块撤下(Founder 裁决),骨架同一天跟着撤 ——
 * 骨架画一张落定页没有的卡,就是把那次跳屏亲手请回来。
 *
 * 同一天深夜,连接卡与 Performance 整块进了幕后(Founder:social media connect 还没准备好,
 * beta V1 只做 creation)。骨架跟着只剩两段:问候 + 创作入口那一行。落定页默认长什么样,
 * 骨架就画什么样 —— **不许**因为「深链 `?connection=` 下还画得出连接卡」就把它留在骨架里:
 * 那条路是显式开闸后才走的,而骨架画的是所有人进来时的第一屏,画上去就是每一次进 Home 都
 * 先闪一张商家这一版看不到的卡。
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

      <section className="r22-home-create-row is-primary">
        <Skeleton className="h-[38px] w-[38px] shrink-0 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-[14px] w-[152px] rounded-[6px]" />
        </div>
        {/* 两件,不是三件:chevron 那颗方形占位随菜单本身 2026-08-26 一起退场
            (beta 卫生大扫除 P2-17)。骨架多画一颗落定页没有的按钮,就是每次进 Home 都先
            闪一个待会儿会消失的东西 —— 这份文件开头那条纪律的原案。 */}
        <div className="r22-home-create-actions">
          <Skeleton className="h-[34px] w-[96px] rounded-[8px]" />
          <Skeleton className="h-[34px] w-[140px] rounded-[8px]" />
        </div>
      </section>

      <span className="sr-only">Loading your home</span>
    </div>
  );
}
