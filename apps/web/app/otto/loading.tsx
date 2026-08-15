import { LoaderCircle } from "lucide-react";

/**
 * #940 — OttoPage has no Suspense boundary of its own: its Server Component awaits roughly a
 * dozen data sources (entities, threads, account, memory, brand records, ads, ad jobs,
 * analytics, greeting name, owner settings, …) before returning any markup at all, so a request
 * to /otto — including the one right after email verification — sent nothing to the browser
 * until every one of those finished. A `loading.tsx` gives Next.js an automatic Suspense
 * boundary around the page: this paints immediately while the real page keeps loading behind it.
 */
export default function OttoLoading() {
  return (
    <main
      className="flex min-h-dvh w-full items-center justify-center bg-background"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-[13.5px] font-medium text-muted-foreground">Loading your workspace…</span>
      </div>
    </main>
  );
}
