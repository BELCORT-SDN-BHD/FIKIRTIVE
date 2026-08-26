import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * 与 registry 原件的两处偏离,都是有意的,各只有一处:
 *
 *   ① `data-slot="spinner"` —— 这一套里每一件都带 `data-slot`,少这一个,业务 css 与测试
 *      就只能去认 `.animate-spin` 这种工具类。
 *   ② `[animation-duration:700ms] motion-reduce:animate-none` —— 转速与「减弱动效下不转」
 *      在**这里**各定一次。收敛之前五份手画的 keyframes 各转各的(800ms / 900ms / .8s /
 *      .7s),而「转不转」是五个开关、其中两个忘了拨(审计 C-10:`r22-brand-spin` 与
 *      `r22-home-spin` 所在文件的减弱动效块只关了 `:active` 缩放)。Emil:转得快的旋转器
 *      让等待显得更短,所以定在比 Tailwind 默认 1s 更快的一档。
 *
 *      减弱动效走 Tailwind 自己的 `motion-reduce:` 变体而不是某份 css 里的一条
 *      `@media`:变体与 `animate-spin` 同在 utilities 层且排在它之后,该赢的时候一定赢;
 *      写进任何一扇门的 css,别的门就照不到 —— 那正是当初五份 keyframes 分家的走法。
 *      判词照围栏 ④:减弱动效是**去运动**(`animation: none`),不是换一种更慢的无限动画。
 *
 * 调用点用 `className` 覆写尺寸与颜色,不再各自写 keyframes。
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn("size-4 animate-spin [animation-duration:700ms] motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner }
