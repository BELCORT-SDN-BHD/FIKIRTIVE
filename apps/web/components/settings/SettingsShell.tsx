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
    <section data-settings-shell className="min-h-full bg-background text-foreground">
      <div className="mx-auto grid min-h-full w-full max-w-[1440px] lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="border-b border-border px-5 py-6 lg:border-b-0 lg:border-r lg:px-4 lg:py-8">
          <p className="px-2 text-xl font-semibold tracking-[-0.025em]">Settings</p>
          <nav className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-1" aria-label="Settings sections">
            {(["Personal", "Workspace"] as const satisfies readonly SettingsScope[]).map((scope) => (
              <div key={scope}>
                <p className="mb-2 px-2 text-xs font-semibold text-muted-foreground">{scope}</p>
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
        </aside>

        <div className="min-w-0 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
            <header className="max-w-2xl border-b border-border pb-6">
              <h1 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              {scopeNote ? (
                <p className="mt-3 text-sm font-medium text-foreground">{scopeNote}</p>
              ) : null}
            </header>
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
