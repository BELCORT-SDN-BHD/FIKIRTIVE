export default function WorkflowsLoading() {
  return (
    <main className="min-h-dvh bg-background px-8 py-9 text-foreground">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-11 w-36 rounded-lg bg-muted" />
        <div className="mt-5 h-10 w-64 rounded-lg bg-muted" />
        <div className="mt-3 h-5 w-[42rem] rounded bg-muted" />
        <div className="mt-8 h-16 rounded-xl bg-muted" />
        <div className="mt-7 grid gap-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-36 rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
              <div className="h-5 w-28 rounded bg-muted" />
              <div className="mt-4 h-6 w-64 rounded bg-muted" />
              <div className="mt-3 h-4 w-48 rounded bg-muted" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading workflows</span>
      </div>
    </main>
  );
}
