"use client"

import Link from "next/link"
import { LogOut, User } from "lucide-react"

import { SHELL_ROUTES } from "@fikirtive/core/navigation"
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

export type MerchantShellAccount = {
  email: string
  displayName: string
  balance: number
}

export function merchantIdentityLabel(account: MerchantShellAccount | null | undefined): string {
  if (!account) return "Account"
  return account.displayName || account.email || "Account"
}

export function MerchantAccountMenu({
  account,
  signOutAction,
  profileHref = SHELL_ROUTES.profile,
  showSignOutAction = true,
}: {
  account?: MerchantShellAccount | null
  signOutAction: () => Promise<void>
  profileHref?: string
  showSignOutAction?: boolean
}) {
  const label = merchantIdentityLabel(account)

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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
