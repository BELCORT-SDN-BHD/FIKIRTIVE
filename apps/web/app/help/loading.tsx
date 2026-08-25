import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() { return <main style={{ width: "min(1100px, calc(100% - 64px))", margin: "0 auto", paddingTop: 48 }}><Skeleton className="h-10 w-72" /><Skeleton className="mt-4 h-4 w-96" /><Skeleton className="mt-8 h-11 w-[720px] max-w-full" /><div className="mt-8 grid grid-cols-2 gap-5"><Skeleton className="h-[360px] rounded-xl" /><Skeleton className="h-[360px] rounded-xl" /></div></main>; }
