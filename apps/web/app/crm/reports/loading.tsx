export default function ReportsLoading() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-11 w-32 rounded bg-muted" />
        <div className="mt-5 h-10 w-72 max-w-full rounded-lg bg-muted" />
        <div className="mt-3 h-5 w-[34rem] max-w-full rounded bg-muted" />
        <div className="mt-8 h-16 rounded-xl bg-muted" />
        <div className="mt-5 grid gap-4">
          {[0, 1].map((item) => (
            <div key={item} className="rounded-[var(--radius-card)] border border-border bg-card p-6">
              <div className="h-6 w-48 rounded bg-muted" />
              <div className="mt-5 grid gap-3 lg:grid-cols-3">
                <div className="h-36 rounded-xl bg-muted" />
                <div className="h-36 rounded-xl bg-muted" />
                <div className="h-36 rounded-xl bg-muted" />
              </div>
            </div>
          ))}
        </div>
        <span className="sr-only">Loading delivery reports</span>
      </div>
    </main>
  );
}
