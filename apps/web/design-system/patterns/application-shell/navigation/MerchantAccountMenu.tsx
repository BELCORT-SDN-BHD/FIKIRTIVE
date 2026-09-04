"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LogOut, User } from "lucide-react"

import { SHELL_ROUTES } from "@fikirtive/core/navigation"
import type { BuildInfoResponse } from "@/lib/build-info"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"

export type MerchantShellAccount = {
  email: string
  displayName: string
  balance: number
}

export function merchantIdentityLabel(account: MerchantShellAccount | null | undefined): string {
  if (!account) return "Account"
  return account.displayName || account.email || "Account"
}

/** `/api/build-info`'s web sha — the only field this menu shows. Failure or no platform-injected
 *  sha (local dev) both read as `null`; the label falls back to "local" either way (P1-012). */
async function defaultFetchBuildSha(): Promise<string | null> {
  try {
    const res = await fetch("/api/build-info")
    if (!res.ok) return null
    const data = (await res.json()) as BuildInfoResponse
    return data.web?.sha ?? null
  } catch {
    return null
  }
}

export function MerchantAccountMenu({
  account,
  signOutAction,
  profileHref = SHELL_ROUTES.profile,
  showSignOutAction = true,
  fetchBuildSha = defaultFetchBuildSha,
}: {
  account?: MerchantShellAccount | null
  signOutAction: () => Promise<void>
  profileHref?: string
  showSignOutAction?: boolean
  /** Injected for tests (`web-page-cache.test.ts`'s DI convention) — production never passes it. */
  fetchBuildSha?: () => Promise<string | null>
}) {
  const label = merchantIdentityLabel(account)
  const [buildSha, setBuildSha] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchBuildSha().then((sha) => {
      if (alive) setBuildSha(sha)
    })
    return () => {
      alive = false
    }
  }, [fetchBuildSha])

  const copyBuildInfoLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/api/build-info`)
      toast.success("Build info link copied")
    } catch {
      toast.error("Couldn't copy the build info link")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-shell-identity
            aria-label="Account menu"
            title={label}
          />
        }
      >
        <Avatar className="size-6">
          <AvatarFallback className="bg-accent text-[0.6rem] font-semibold text-accent-foreground">
            {(account ? label : "?").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-foreground">{label}</span>
            {account?.email ? <span className="mt-0.5 block truncate font-normal">{account.email}</span> : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href={profileHref} data-shell-profile />}>
            <User />
            <span>Profile</span>
          </DropdownMenuItem>
          {showSignOutAction ? (
            <DropdownMenuItem
              data-shell-signout
              variant="destructive"
              onSelect={() => {
                void signOutAction()
              }}
            >
              <LogOut />
              <span>Sign out</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {/* P1-012 — release identity, compact so it never competes with Profile/Sign out. */}
          <DropdownMenuItem
            data-shell-build-info
            onSelect={() => {
              void copyBuildInfoLink()
            }}
          >
            <span className="text-xs text-muted-foreground">Build {buildSha ?? "local"}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
