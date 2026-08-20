/**
 * Home 的等待态 —— 全部走 `ui/skeleton`,一枚手搓的 `animate-pulse` 都没有
 * (换壳规格书 §5.6:手搓骨架是这一波要收掉的三类之一)。
 *
 * 骨架只画**这一页真的会有的东西**的形状:一行问候、一个开工框、一列画布。不画磁贴 ——
 * 一个后面不会出现的形状,等于在加载的那一秒也说了一次大话。
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <main className="min-h-dvh bg-background px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <section>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-3 h-4 w-48" />
          <Skeleton className="mt-6 h-12 w-full max-w-[720px] rounded-[16px]" />
        </section>
        <section>
          <Skeleton className="h-3 w-40" />
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </section>
      </div>
    </main>
  );
}
