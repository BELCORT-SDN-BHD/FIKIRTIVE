import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() { return <main style={{ width: "min(1040px, calc(100% - 64px))", margin: "0 auto", paddingTop: 46 }}><Skeleton className="h-10 w-64" /><Skeleton className="mt-4 h-4 w-96" /><Skeleton className="mt-10 h-[380px] w-full rounded-xl" /></main>; }
