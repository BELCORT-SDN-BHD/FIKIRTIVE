import { Skeleton } from "@/design-system/primitives/skeleton";

export default function HomeAnalysisLoading() {
  return (
    <main className="mx-auto w-full max-w-[1220px] px-8 py-6" aria-busy="true" aria-label="Loading Home analysis">
      <Skeleton className="h-8 w-28" />
      <Skeleton className="mt-5 h-9 w-56" />
      <div className="mt-4 flex gap-2 border-b border-border pb-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="mt-7 grid grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)] gap-8 border-b border-border pb-7">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="mt-7 h-[330px] w-full" />
    </main>
  );
}
