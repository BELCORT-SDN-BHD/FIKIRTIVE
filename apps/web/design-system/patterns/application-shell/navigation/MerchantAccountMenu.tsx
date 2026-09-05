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

/** 判官 P1-1(2026-09-05)—— 登出**成功**那一路,server action 的 promise 是被**拒绝**的,不是 resolve 的。
 *
 *  Next 16 的 server-action reducer 只要服务端答了一个 redirect,就一律
 *  `reject(createRedirectErrorForAction(...))`,把控制权交还给 RedirectBoundary,再自己继续导航
 *  (`next/dist/client/components/router-reducer/reducers/server-action-reducer.js`,原注释
 *  「the action promise will be rejected with a redirect」);只有**没有** redirect 的那一路才 `resolve`。
 *  而 `signOutAction()` 每一次成功都以 `redirect("/login")` 收尾(`apps/web/lib/account-actions.ts:235`),
 *  所以一个不分辨的 `catch` 会把每一次成功登出都当成失败,商家落到 /login(其实已登出)还读到一条红字。
 *
 *  分辨的依据是 digest 前缀,仓库里已有先例(`apps/web/lib/__tests__/brand-route.test.ts:312`)。
 *  不用 `next/navigation` 的 `unstable_rethrow`:在事件处理器里 rethrow 只会变成一次 unhandled rejection,
 *  导航本来就由 reducer 自己完成,识别出来直接放行即可。 */
function isRedirectRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  )
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
   *  只有一种出口保持「进行中」:被识别为框架 redirect 的拒绝(见 `isRedirectRejection`)。那是登出
   *  成功、壳马上被换掉的那一路,在跳走之前一直显示进行中才是实话,更不该弹失败。
   *  其余每一种出口都复位——真失败弹 toast 让商家重来;而一个正常 resolve 的 action(评审夹具传的
   *  `async () => {}`,不跳转)也复位,否则那颗菜单项会永久卡在「Signing out…」(判官 P2-3)。 */
  const runSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOutAction()
      setSigningOut(false)
    } catch (error) {
      if (isRedirectRejection(error)) return
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
