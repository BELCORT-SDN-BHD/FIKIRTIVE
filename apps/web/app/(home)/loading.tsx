import { Skeleton } from "@/design-system/primitives/skeleton";

export default function HomeLoading() {
  return (
    <main className="mx-auto w-full max-w-[1220px] px-8 py-6" aria-busy="true" aria-label="Loading Home">
      <Skeleton className="h-9 w-28" />
      <div className="mt-4 flex gap-2 border-b border-border pb-4">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex items-center gap-3 border-b border-border py-3">
        <div className="mr-auto">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      <section className="border-b border-border py-6">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="mt-3 h-4 w-[520px]" />
        <div className="mt-8 grid grid-cols-[220px_minmax(0,1fr)] gap-8">
          <div className="space-y-5">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-[180px] w-full" />
        </div>
      </section>
    </main>
  );
}
