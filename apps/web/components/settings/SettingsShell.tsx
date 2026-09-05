import Link from "next/link"
import { CircleUserRound, CreditCard, Settings2, Unplug } from "lucide-react"

import { SETTINGS_SECTIONS, type SettingsScope } from "@fikirtive/core/navigation"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]["key"]

const SECTION_ICONS = {
  profile: CircleUserRound,
  general: Settings2,
  connections: Unplug,
  billing: CreditCard,
} as const

/**
 * Settings 外壳 —— 前端基线第⑦段(FRONT-A11)。
 *
 * 权威是已冻结的 Settings screen pattern:`design-system/patterns/settings/README.md`
 * (Founder approved and frozen 2026-08-31)与它的夹具 `SettingsReference.tsx`
 * (`/product-patterns/settings`)。这一版把生产外壳搬到夹具的几何上,一处一处对:
 *
 *   ① **页头是最上面一整条**,不再缩在内容列里。标题跟随 active destination
 *      (README §2:「页面标题跟随 active destination;`Settings` 只保留在 shell context」),
 *      所以左轨上那行写死的 "Settings" 标题去掉了 —— 顶栏已经写着它。
 *   ② **左轨 220px**、`px-4 py-6`,两个 scope group 之间一条分隔线;group 标题是
 *      `text-foreground`,不是 muted。
 *   ③ 内容列 `px-7`,自己滚动;页头与左轨不跟着滚。
 *   ④ 影响范围那一句带 `CircleUserRound` 图标、muted —— 夹具里就是这个长相。
 *
 * 生产必需、夹具没有的只有窄屏一件:夹具是桌面评审件,一个断点都没有;生产页在 `lg` 以下
 * 把左轨叠到内容上方(换皮前生产外壳本来的做法),用的仍然是夹具的 token 与 class,
 * 不自创第二套样式。
 */
export function SettingsShell({
  active,
  title,
  description,
  scopeNote,
  children,
}: {
  active: SettingsSectionKey
  title: string
  description: string
  scopeNote?: string
  children: React.ReactNode
}) {
  return (
    <main
      data-settings-shell
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <header className="shrink-0 border-b border-border px-5 py-6 sm:px-7">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {scopeNote ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <CircleUserRound className="size-4" aria-hidden />
            {scopeNote}
          </p>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav
          className="shrink-0 border-b border-border bg-background px-4 py-6 lg:w-[220px] lg:border-b-0 lg:border-r"
          aria-label="Settings sections"
        >
          {(["Personal", "Workspace"] as const satisfies readonly SettingsScope[]).map((scope, scopeIndex) => (
            <div key={scope} className={cn(scopeIndex > 0 && "mt-7 border-t border-border pt-6")}>
              <p className="mb-2 px-2 text-xs font-semibold text-foreground">{scope}</p>
              <div className="space-y-1">
                {SETTINGS_SECTIONS.filter((item) => item.scope === scope).map((item) => {
                  const Icon = SECTION_ICONS[item.key]
                  const selected = item.key === active
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      aria-current={selected ? "page" : undefined}
                      className={cn(
                        buttonVariants({ variant: "ghost", motion: "instant" }),
                        "h-10 w-full justify-start px-2.5 font-medium text-muted-foreground",
                        selected && "bg-secondary text-foreground",
                      )}
                    >
                      <Icon aria-hidden />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 overflow-y-auto px-5 sm:px-7">{children}</div>
      </div>
    </main>
  )
}
