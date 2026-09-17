import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * City Hall 自己的 404(R3-F11 判官 P3)。
 *
 * 根 `app/not-found.tsx` 画的是**商家**的壳。`app/admin/tenants/[orgId]/page.tsx` 查不到那个
 * 租户时调的 `notFound()` 会落到最近的这一层 —— 没有这个文件,一个管理员会在 City Hall 里
 * 突然看到商家导轨与余额行。这一页长在 `app/admin/layout.tsx` 里面,所以答的是同一面墙里的话。
 *
 * 只接**这棵子树里 `notFound()` 抛出来的**那一类;`/admin/<没建过的段>` 这种地址匹配不上任何
 * 路由,Next 按设计仍然交给根那一页(登记在规格 §5 的 R3-F11 行)。
 */
export default function AdminNotFound() {
  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[760px] gap-4">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Admin</p>
        <h1 className="text-2xl font-semibold leading-tight">Not found</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          This admin record does not exist, or it was removed.
        </p>
        <div>
          <Button asChild variant="secondary">
            <Link href="/admin">Back to City Hall</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
