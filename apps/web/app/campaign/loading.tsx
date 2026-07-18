export default function CampaignLoading() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-11 w-32 rounded bg-muted" />
        <div className="mt-5 h-12 w-full max-w-xl rounded-xl bg-muted" />
        <div className="mt-8 h-10 w-72 max-w-full rounded-lg bg-muted" />
        <div className="mt-3 h-5 w-[32rem] max-w-full rounded bg-muted" />
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <div className="h-64 rounded-[var(--radius-card)] border border-border bg-card" />
          <div className="h-64 rounded-[var(--radius-card)] border border-border bg-card" />
          <div className="h-64 rounded-[var(--radius-card)] border border-border bg-card" />
        </div>
        <span className="sr-only">Loading campaigns</span>
      </div>
    </main>
  );
}

