export default function CustomerSegmentsLoading() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-4 w-28 rounded bg-muted" />
        <div className="mt-5 h-10 w-72 max-w-full rounded-lg bg-muted" />
        <div className="mt-3 h-5 w-[32rem] max-w-full rounded bg-muted" />
        <div className="mt-8 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="h-[28rem] rounded-[var(--radius-card)] border border-border bg-card" />
          <div className="h-[28rem] rounded-[var(--radius-card)] border border-border bg-card" />
        </div>
        <span className="sr-only">Loading customer segments</span>
      </div>
    </main>
  );
}
