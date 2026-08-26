import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * 与 registry 原件的两处偏离,都是有意的,各只有一处:
 *
 *   ① `data-slot="spinner"` —— 这一套里每一件都带 `data-slot`,少这一个,业务 css 与测试
 *      就只能去认 `.animate-spin` 这种工具类。
 *   ② `[animation-duration:700ms]` —— 转速在**这里**定一次。收敛之前五份手画的 keyframes
 *      各转各的(800ms / 900ms / .8s / .7s),同一件事在五扇门里快慢不一。Emil:转得快的
 *      旋转器让等待显得更短,所以定在比 Tailwind 默认 1s 更快的一档;要改也只改这一行。
 *
 * 调用点用 `className` 覆写尺寸与颜色,不再各自写 keyframes。
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn("size-4 animate-spin [animation-duration:700ms]", className)}
      {...props}
    />
  )
}

export { Spinner }
