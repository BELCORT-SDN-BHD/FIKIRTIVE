export default function InboxLoading() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-11 w-32 rounded bg-muted" />
        <div className="mt-5 h-10 w-56 max-w-full rounded-lg bg-muted" />
        <div className="mt-3 h-5 w-[30rem] max-w-full rounded bg-muted" />
        <div className="mt-8 h-11 w-full max-w-xl rounded-full bg-muted" />
        <div className="mt-5 h-16 rounded-[var(--radius-card)] border border-border bg-card" />
        <div className="mt-5 grid gap-3">
          <div className="h-24 rounded-[var(--radius-card)] border border-border bg-card" />
          <div className="h-24 rounded-[var(--radius-card)] border border-border bg-card" />
          <div className="h-24 rounded-[var(--radius-card)] border border-border bg-card" />
          <div className="h-24 rounded-[var(--radius-card)] border border-border bg-card" />
        </div>
        <span className="sr-only">Loading Inbox</span>
      </div>
    </main>
  );
}
