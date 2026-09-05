"use client"

import { ChevronRight } from "lucide-react"

import { OTTO_ASSISTANT, navLabel } from "@fikirtive/core/navigation"
import { OttoAvatar } from "@/components/otto/OttoAvatar"
import { Button } from "@/components/ui/button"
import { activeNavKey } from "@/components/navigation/rail/rail-tree"
import {
  MerchantAccountMenu,
  type MerchantShellAccount,
} from "@/components/navigation/MerchantAccountMenu"

export function MerchantTopBar({
  pathname,
  account,
  signOutAction,
  onAskOtto,
  activeLabelOverride,
  profileHref,
  showSignOutAction,
  buildSha,
}: {
  pathname: string
  account?: MerchantShellAccount | null
  signOutAction: () => Promise<void>
  /** `undefined` on a surface that doesn't mount the shared Otto panel (`panel-surface.ts`'s
   *  "this page already has its own Otto" list) — the button has nothing to open there, so it
   *  doesn't render rather than sitting there doing nothing when pressed (判官 P1-A). */
  onAskOtto?: () => void
  activeLabelOverride?: string
  profileHref?: string
  showSignOutAction?: boolean
  /** P2-3 — passthrough from MerchantShellFrame straight to MerchantAccountMenu's `Build <sha>`
   *  row; this component owns no logic about it. */
  buildSha?: string | null
}) {
  const activeKey = activeNavKey(pathname)
  const activeLabel = activeLabelOverride ?? (activeKey ? navLabel(activeKey) : "Workspace")

  return (
    <header
      data-merchant-topbar
      className="flex h-11 shrink-0 items-center border-b border-border bg-card px-3 text-xs text-muted-foreground"
    >
      <span>Workspace</span>
      <ChevronRight className="mx-1.5 size-3.5" aria-hidden="true" />
      <span className="font-medium text-foreground">{activeLabel}</span>

      <div className="ml-auto flex items-center gap-1">
        {onAskOtto ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-shell-ask-otto
            onClick={onAskOtto}
            aria-label={OTTO_ASSISTANT.label}
          >
            <OttoAvatar size={18} mood="idle" />
            {OTTO_ASSISTANT.label}
          </Button>
        ) : null}
        <MerchantAccountMenu
          account={account}
          signOutAction={signOutAction}
          profileHref={profileHref}
          showSignOutAction={showSignOutAction}
          buildSha={buildSha}
        />
      </div>
    </header>
  )
}
