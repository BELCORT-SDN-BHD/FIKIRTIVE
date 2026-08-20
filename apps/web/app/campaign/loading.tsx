import { Skeleton } from "@/components/ui/skeleton";

// W2-12(#997,规格书 §5.6 ③):骨架换成 `ui/skeleton`,不再手搓 `animate-pulse` 的 div。
export default function CampaignLoading() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Skeleton className="h-11 w-32" />
        <Skeleton className="mt-5 h-12 w-full max-w-xl rounded-xl" />
        <Skeleton className="mt-8 h-10 w-72 max-w-full rounded-lg" />
        <Skeleton className="mt-3 h-5 w-[32rem] max-w-full" />
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-64 rounded-[var(--radius-card)]" />
          <Skeleton className="h-64 rounded-[var(--radius-card)]" />
          <Skeleton className="h-64 rounded-[var(--radius-card)]" />
        </div>
        <span className="sr-only">Loading campaigns</span>
      </div>
    </main>
  );
}

