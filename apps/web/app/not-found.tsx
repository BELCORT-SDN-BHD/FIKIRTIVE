import Link from "next/link";
import { Compass } from "lucide-react";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { MerchantAppShell } from "@/components/global-navigation";
import { signOutAction } from "@/lib/account-actions";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * 全产品的兜底 404 —— 没建过的地址落在这里,而不是 Next 自带的那堵墙(R3-F11)。
 *
 * 四条停放前缀(`/crm`、`/campaign`、`/schedule`、`/library/editor`)底下的乱地址各有自己的
 * catch-all,一律 307 回冻结去处;这一页接的是**其余全部** —— `/definitely-not-a-route`、
 * 一条拼错的旧链接、一个被截断的分享地址。此前它们落进的是 Next 自带的 404:标题只剩
 * `Fikirtive`,没有导轨、没有账号菜单、没有一条回去的路。商家在自己的产品里撞见一堵与产品
 * 无关的墙,而这一类地址**没有正确去处**可送 —— 它真的不存在,所以诚实的答案是 404,只是
 * 这个 404 必须长在产品里面。
 *
 * **壳由这一页自己带上**(`carriesShell`),不是把 `isMerchantSurface` 放宽:那份名单是按
 * 地址推出来的,同一份名单还挡着 `/login`、`/admin` 与免登录的公开分享页,而「没建过的
 * 地址」在名单里根本表达不出来(理由全文在 `components/global-navigation.tsx` 那个 prop 上)。
 * 根 layout 已经把壳画过一次 —— 在这条地址上它答的是「不画」,所以这里嵌的这一层是屏幕上
 * 唯一的那一份壳,不是第二份。
 *
 * 没有会话的人到不了这里:认证墙(`proxy.ts` + `lib/auth-wall-ledger.ts`)在路由之前就把他
 * 送去 `/login?from=…`。这一页因此只对**已登录的商家**说话,那也正是「壳还在」有意义的
 * 那一个人。
 */
export default function NotFound() {
  return (
    <MerchantAppShell signOutAction={signOutAction} carriesShell>
      <main className="flex min-h-full flex-col justify-center px-4 py-10 sm:px-6">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Compass aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Page not found</EmptyTitle>
            <EmptyDescription>
              This address does not lead anywhere in Fikirtive — nothing of yours was lost.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href={SHELL_ROUTES.home}>Back to Home</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </main>
    </MerchantAppShell>
  );
}
