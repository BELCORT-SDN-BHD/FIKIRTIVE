"use client";

/** Global error boundary — every error state needs an inline recovery action. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-display text-xl font-semibold">Something broke</h1>
      <p className="text-sm text-dim max-w-md">
        {error.message || "An unexpected error occurred."} Your saved data is
        safe — this only affects the current view.
      </p>
      <button
        onClick={reset}
        className="bg-accent text-[#1a0e06] font-semibold text-sm rounded-[var(--radius-sm)] px-4 py-2"
      >
        Reload workbench
      </button>
    </main>
  );
}
