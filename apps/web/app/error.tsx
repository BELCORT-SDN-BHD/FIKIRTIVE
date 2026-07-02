"use client";

import { Button } from "@/components/ui/button";

/** Global error boundary — every error state needs an inline recovery action. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    // F42: shadcn tokens, not Vapor `text-dim`/`btn-primary` — text-dim is translucent white and
    // was illegible on the light `.gb` body, and btn-primary no longer exists post-migration.
    <main className="gb min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something broke</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        {error.message || "An unexpected error occurred."} Your saved data is
        safe — this only affects the current view.
      </p>
      <Button onClick={reset}>Reload workbench</Button>
    </main>
  );
}
