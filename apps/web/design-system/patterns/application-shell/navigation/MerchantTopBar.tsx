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
}: {
  pathname: string
  account?: MerchantShellAccount | null
  signOutAction: () => Promise<void>
  onAskOtto: () => void
  activeLabelOverride?: string
  profileHref?: string
  showSignOutAction?: boolean
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
        <MerchantAccountMenu account={account} signOutAction={signOutAction} profileHref={profileHref} showSignOutAction={showSignOutAction} />
      </div>
    </header>
  )
}
