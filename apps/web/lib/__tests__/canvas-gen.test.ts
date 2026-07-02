import { describe, it, expect, vi } from "vitest";
import {
  createNodeWithRetry,
  pollGenJob,
  isInFlightPaidGen,
  CANVAS_POLL_MAX_ATTEMPTS,
  CANVAS_POLL_INTERVAL_MS,
} from "../canvas-gen";

const noWait = async () => {};

describe("isInFlightPaidGen (delete-guard predicate)", () => {
  // A paid GenJob that hasn't resolved to media yet: deleting it won't refund and
  // re-running mints a fresh key → 2nd charge. The delete confirm must warn.
  it("true for a still-generating image (pending, no url)", () => {
    expect(isInFlightPaidGen({ type: "image", status: "pending" })).toBe(true);
  });
  it("true for a timed-out video (still running server-side, no url)", () => {
    expect(isInFlightPaidGen({ type: "video", status: "timeout" })).toBe(true);
  });
  it("false once resolved to media (has url)", () => {
    expect(isInFlightPaidGen({ type: "image", status: "pending", url: "https://r2/x.png" })).toBe(false);
    expect(isInFlightPaidGen({ type: "video", status: "done", url: "https://tos/v.mp4" })).toBe(false);
  });
  it("false for a failed gen (terminal → already refunded, safe to delete)", () => {
    expect(isInFlightPaidGen({ type: "image", status: "failed" })).toBe(false);
  });
  it("false for a text node (never paid)", () => {
    expect(isInFlightPaidGen({ type: "text", status: "pending" })).toBe(false);
  });
});

describe("createNodeWithRetry (canvas paid-card placement)", () => {
  it("returns the node on first success", async () => {
    const create = vi.fn(async () => ({ id: "node-1" }));
    const out = await createNodeWithRetry(create, { projectId: "p" } as any, { wait: noWait });
    expect(out).toEqual({ id: "node-1" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("CATCHES a thrown (transient) failure and retries — a throw must NOT escape", async () => {
    // Bug B1: the pre-fix loop had no try/catch, so a rejected promise (network
    // flake / thrown DB error) escaped on attempt 1 → no card → owner reclicks →
    // second paid job. The retry must catch the throw and try again.
    let n = 0;
    const create = vi.fn(async () => {
      n++;
      if (n < 3) throw new Error("network flake");
      return { id: "node-9" };
    });
    const out = await createNodeWithRetry(create, {} as any, { wait: noWait });
    expect(out).toEqual({ id: "node-9" });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("returns an {error} sentinel after all attempts throw — never rejects to the caller", async () => {
    const create = vi.fn(async () => {
      throw new Error("persistent DB error");
    });
    const out = await createNodeWithRetry(create, {} as any, { attempts: 3, wait: noWait });
    expect("error" in out).toBe(true);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("retries a deterministic {error} return then succeeds", async () => {
    let n = 0;
    const create = vi.fn(async () => (++n < 2 ? { error: "blip" } : { id: "node-2" }));
    const out = await createNodeWithRetry(create, {} as any, { wait: noWait });
    expect(out).toEqual({ id: "node-2" });
  });
});

describe("pollGenJob (canvas gen status poll)", () => {
  const ref = () => ({ current: false });

  it("DONE → onDone(urls, 'done', generationIds)", async () => {
    const getJob = vi.fn(async () => ({ status: "DONE", urls: ["u1"], generationIds: ["g1"] }));
    const onDone = vi.fn();
    await pollGenJob(getJob, "j", onDone, ref(), { wait: noWait });
    expect(onDone).toHaveBeenCalledWith(["u1"], "done", ["g1"]);
  });

  it("FAILED → onDone([], 'failed', [])", async () => {
    const getJob = vi.fn(async () => ({ status: "FAILED", urls: [] }));
    const onDone = vi.fn();
    await pollGenJob(getJob, "j", onDone, ref(), { wait: noWait });
    expect(onDone).toHaveBeenCalledWith([], "failed", []);
  });

  it("still running past the ceiling → onDone([], 'timeout', []) — NOT 'failed'", async () => {
    // Bug B2: the pre-fix poll gave up at ~120s and reported 'failed' even though
    // the worker window is ~20min and the job is still running + will settle. A
    // 'failed'-looking-but-actually-running card invites delete+reclick → a second
    // full charge. Report 'timeout' so the card stays a truthful "still working".
    const getJob = vi.fn(async () => ({ status: "GENERATING", urls: [] }));
    const onDone = vi.fn();
    await pollGenJob(getJob, "j", onDone, ref(), { maxAttempts: 5, wait: noWait });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith([], "timeout", []);
    expect(getJob).toHaveBeenCalledTimes(5);
  });

  it("stops silently when cancelled (no onDone)", async () => {
    const cancelled = { current: true };
    const getJob = vi.fn(async () => ({ status: "GENERATING", urls: [] }));
    const onDone = vi.fn();
    await pollGenJob(getJob, "j", onDone, cancelled, { wait: noWait });
    expect(onDone).not.toHaveBeenCalled();
    expect(getJob).not.toHaveBeenCalled();
  });

  it("stops silently when the job disappears (null)", async () => {
    const getJob = vi.fn(async () => null);
    const onDone = vi.fn();
    await pollGenJob(getJob, "j", onDone, ref(), { wait: noWait });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("the default poll ceiling covers the real server window (≥ 5 min)", async () => {
    // The BytePlus video provider itself times out at ~5 min, so a 6-min client
    // ceiling means the client observes the TRUE terminal state (DONE/FAILED) for
    // real jobs instead of prematurely timing out.
    expect(CANVAS_POLL_MAX_ATTEMPTS * CANVAS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
