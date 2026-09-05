"use client"

import { useState } from "react"
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
import { Spinner } from "@/components/ui/spinner"
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

export function MerchantAccountMenu({
  account,
  signOutAction,
  profileHref = SHELL_ROUTES.profile,
  showSignOutAction = true,
  buildSha = null,
}: {
  account?: MerchantShellAccount | null
  signOutAction: () => Promise<void>
  profileHref?: string
  showSignOutAction?: boolean
  /** P2-3(判官四轮):`buildInfo(process.env).sha`,读法是纯同步 env 读取——`getMyAccount()`
   *  在 `global-navigation.tsx` 已经在跑的那一趟顺风车带下来的,这个组件自己不发任何请求。
   *  没有平台注入(本机)或还没加载完都是 `null`,标签统一落 "local"。 */
  buildSha?: string | null
}) {
  const label = merchantIdentityLabel(account)
  const [signingOut, setSigningOut] = useState(false)

  /** FRONT-A12 —— 登出以前是 `void signOutAction()`:点下去屏幕上什么都不变,失败了也什么都不说,
   *  商家读到的是「大概退出了吧」。
   *
   *  成功这一路不复位 `signingOut`:`signOutAction()` 服务端跑完就 `redirect("/login")`
   *  (`apps/web/lib/account-actions.ts:235`),这个组件会随整个壳被换掉,所以在跳走之前一直
   *  显示进行中才是实话。失败这一路才复位,并把原因说出来。 */
  const runSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOutAction()
    } catch {
      setSigningOut(false)
      toast.error("Couldn't sign you out. Try again.")
    }
  }

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
              /* 菜单不在这一下关掉:关掉就没地方显示进行中,失败时商家也看不出是哪一颗按钮的事。 */
              closeOnClick={false}
              disabled={signingOut}
              aria-busy={signingOut || undefined}
              onSelect={() => {
                void runSignOut()
              }}
            >
              {signingOut ? <Spinner /> : <LogOut />}
              <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {/* P1-012 — release identity, compact so it never competes with Profile/Sign out.
              判官四轮 P2-2:可见文案是紧凑版本号,读屏该报的是这颗项真正做的事(复制链接),
              两者不是同一句话,所以 aria-label 单独给。 */}
          <DropdownMenuItem
            data-shell-build-info
            aria-label="Copy build info link"
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
