// Pure control-flow helpers behind the canvas generation hook (useCanvasGen),
// extracted so the retry + poll logic can be unit-tested without React. The
// server actions and the sleep are INJECTED — this module imports nothing that
// touches the network or Prisma, so it is a plain unit.

type NodeResult = { id: string } | { error: string };
type JobSnapshot = { status: string; urls: string[]; generationIds?: string[] } | null;
type Ref = { current: boolean };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll cadence. The BytePlus video provider itself times out at ~5 min, and the
 * worker's job window is 20 min — so the client ceiling must comfortably exceed
 * the real server window, or a still-running paid job reads as done/failed and
 * the owner reclicks. 144 × 2500ms = 6 min: long enough that the client observes
 * the TRUE terminal state (DONE/FAILED) for real jobs.
 */
export const CANVAS_POLL_INTERVAL_MS = 2500;
export const CANVAS_POLL_MAX_ATTEMPTS = 144;

/**
 * createCanvasNode with a small retry. By the time we place a paid GenJob's card,
 * startGen has already reserved/queued it — so a transient node-create failure
 * must not silently drop the card, or the owner sees nothing, clicks "Make it"
 * again, and mints a fresh idempotencyKey → a second paid job.
 *
 * createCanvasNode can fail two ways: it RETURNS `{ error }` (deterministic gate /
 * ownership denial) or it THROWS (transient network / thrown DB error). BOTH are
 * retried; the throw is caught so a rejected promise can never escape the loop on
 * the first attempt (bug B1). If it still fails the paid output is not lost (it
 * lands in the library) — we log and return the `{ error }` sentinel so callers'
 * `if ("error" in x) return` handles it without a second spend.
 */
export async function createNodeWithRetry<A>(
  create: (args: A) => Promise<NodeResult>,
  args: A,
  opts: { attempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<NodeResult> {
  const attempts = opts.attempts ?? 3;
  const wait = opts.wait ?? sleep;
  let last: NodeResult = { error: "not attempted" };
  for (let i = 0; i < attempts; i++) {
    try {
      last = await create(args);
    } catch (e) {
      last = { error: e instanceof Error ? e.message : "canvas node create threw" };
    }
    if ("id" in last) return last;
    if (i < attempts - 1) await wait(300 * (i + 1));
  }
  console.warn(
    "[canvas] createCanvasNode failed after retries — a paid job's card is missing (output still in the library):",
    last,
  );
  return last;
}

/**
 * Poll a GenJob to a terminal state, then hand the result to onDone.
 *
 * On DONE → ("done"), on FAILED → ("failed"). If the poll window is exhausted
 * while the job is STILL running (bug B2), report **"timeout"**, NOT "failed":
 * a failed-looking-but-actually-running card invites the owner to delete + reclick,
 * minting a fresh per-click idempotencyKey → a second full charge. "timeout" lets
 * the UI keep a truthful "still working — it'll appear in your library" state.
 */
export async function pollGenJob(
  getJob: (jobId: string) => Promise<JobSnapshot>,
  jobId: string,
  onDone: (urls: string[], status: string, generationIds: string[]) => void,
  cancelledRef: Ref,
  opts: { maxAttempts?: number; intervalMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? CANVAS_POLL_MAX_ATTEMPTS;
  const intervalMs = opts.intervalMs ?? CANVAS_POLL_INTERVAL_MS;
  const wait = opts.wait ?? sleep;
  for (let i = 0; i < maxAttempts; i++) {
    if (cancelledRef.current) return;
    const job = await getJob(jobId);
    if (!job) return;
    if (job.status === "DONE") return onDone(job.urls, "done", job.generationIds ?? []);
    if (job.status === "FAILED") return onDone([], "failed", []);
    await wait(intervalMs);
  }
  onDone([], "timeout", []);
}
