import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/brand` 的等待画面。
 *
 * 为什么要有它:`BrandPage` 是一个 Server Component,它要先把品牌记忆、品牌记录、元素、
 * 最近生成与广告五路读完才吐出第一个字节。没有 `loading.tsx` 的时候浏览器在这段时间里
 * 什么都拿不到(#940 在 `/otto` 上量过同一件事)。Next.js 拿这个文件给页面套一层
 * Suspense,先画这一屏。
 *
 * 骨架用 `components/ui/skeleton`,不手搓 `animate-pulse` 的 div(规格书 §5.6 ③)——
 * 手搓的那些正是走查里点名的一类:一份配方散在七八个文件里,改一次要改八处。
 */
export default function BrandLoading() {
  return (
    <main className="flex min-h-dvh flex-col bg-background" role="status" aria-live="polite">
      <div className="flex-1 overflow-hidden p-[24px_28px_36px]">
        <div className="mx-auto max-w-[720px]">
          {/* 标题 + 两句说明 */}
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-[9px] h-5 w-full max-w-[26rem]" />
          <Skeleton className="mt-[6px] h-5 w-full max-w-[34rem]" />

          {/* 与 Otto 聊品牌的那张卡 */}
          <Skeleton className="mt-[18px] h-[212px] w-full rounded-[16px]" />

          {/* 六个页签 */}
          <Skeleton className="mt-5 h-[46px] w-full max-w-[30rem] rounded-[14px]" />

          {/* 当前页签的内容 */}
          <Skeleton className="mt-4 h-32 w-full rounded-[14px]" />
          <Skeleton className="mt-3 h-32 w-full rounded-[14px]" />
        </div>
      </div>
      <span className="sr-only">Loading your brand</span>
    </main>
  );
}
