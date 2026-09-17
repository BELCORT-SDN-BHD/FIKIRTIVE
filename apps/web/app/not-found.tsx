import type { ReactNode } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { MerchantAppShell } from "@/components/global-navigation";
import { requireSession } from "@/lib/auth-guard";
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
 * `Fikirtive`,没有导轨、没有账号菜单、没有一条回去的路。这一类地址**没有正确去处**可送 ——
 * 它真的不存在,所以诚实的答案仍是 404,只是这个 404 必须长在产品里面。
 *
 * ── 画不画壳,由**会话**决定,不由地址决定(判官 P2)───────────────────────────────────
 * 认证墙(`proxy.ts` + `lib/auth-wall-ledger.ts`)并不是把每一条地址都挡在外面:`s`、
 * `privacy`、`legal` 这几棵子树整棵在墙外(分享链接、法务页,读它们的人按定义没有账号)。
 * 所以「走到这一页的人一定登录过」是假的 —— 照那句假话画壳,一个没有账号的读者会看到导轨、
 * 余额行与账号菜单,还白付一次取不到数的已认证往返。这里改成读会话:
 *
 *   · 有会话 → 壳画出来(导轨、账号菜单、一条回 Home 的路),商家仍站在自己的产品里;
 *   · 没有会话 → 一张干净的卡,加一条去登录的路 —— 不假装他有一个工作区。
 *
 * ── 壳由这一页自己带上,而不是把名单放宽 ─────────────────────────────────────────────
 * `isMerchantSurface` 是一份按地址推出来的名单,同一份名单还挡着 `/login`、`/admin` 与免登录
 * 的公开分享页,而「没建过的地址」在名单里根本表达不出来(理由全文在
 * `components/global-navigation.tsx` 那个 prop 上)。名单一个字没动,这一页自己传
 * `carriesShell`。
 *
 * 根 layout 那一层壳也可能**已经**画着了:`isMerchantSurface` 按前缀匹配,所以
 * `/billing/<没建过的段>` 这类地址对它来说就是商家表面。两层各画一遍由
 * `MerchantShellContent` 的 `ShellDrawnContext` 挡掉(里层原样透出 children)——
 * 屏幕上永远只有一份壳,这一页不必猜自己嵌在谁里面。
 */

/** 没有会话的人该往哪去。全仓的墙与 `app/admin/layout.tsx` 写的是同一个字面量。 */
const SIGN_IN_HREF = "/login";

function NotFoundCard({ action }: { action: ReactNode }) {
  return (
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
        <EmptyContent>{action}</EmptyContent>
      </Empty>
    </main>
  );
}

export default async function NotFound() {
  const gate = await requireSession();

  if ("error" in gate) {
    return (
      <NotFoundCard
        action={
          <Button asChild>
            <Link href={SIGN_IN_HREF}>Go to sign in</Link>
          </Button>
        }
      />
    );
  }

  return (
    <MerchantAppShell signOutAction={signOutAction} carriesShell>
      <NotFoundCard
        action={
          <Button asChild>
            <Link href={SHELL_ROUTES.home}>Back to Home</Link>
          </Button>
        }
      />
    </MerchantAppShell>
  );
}
