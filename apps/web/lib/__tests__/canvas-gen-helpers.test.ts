/**
 * canvas-gen-helpers.test.ts — F20 + F21: the module-level helpers behind useCanvasGen.
 *
 * F20: createNodeWithRetry must retry a THROWN/REJECTED createCanvasNode (the real transient
 *      failure class — a network blip on the server action), not only the {error} return
 *      shape, and return {error} after exhaustion instead of letting the throw escape.
 * F21: poll must not give up at a fixed 48-iteration (~2 min) cap — video gens can exceed
 *      2 min and the worker still settles them — and a client-side give-up must report a
 *      distinct "timeout" status (not "failed"), so the card doesn't hard-fail a job that
 *      may still complete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ createCanvasNode: vi.fn(), getGenJob: vi.fn(), startCanvasGen: vi.fn() }));
vi.mock("../canvas-actions", () => ({ createCanvasNode: m.createCanvasNode }));
vi.mock("../gen-actions", () => ({ getGenJob: m.getGenJob, startCanvasGen: m.startCanvasGen }));

import {
  clearCanvasActionReceipt,
  claimCanvasActionReceipt,
  createNodeWithRetry,
  isInFlightPaidGen,
  loadCanvasActionReceipts,
  poll,
  retainCanvasActionIdentity,
  saveCanvasActionReceipt,
  startCanvasAction,
  type StoredCanvasActionReceipt,
} from "../../components/canvas/useCanvasGen";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("isInFlightPaidGen (paid-aware delete-guard predicate)", () => {
  // A paid GenJob that hasn't resolved to media yet: deleting the card won't refund it and
  // re-running mints a fresh per-click idempotencyKey → a SECOND charge. The delete confirm
  // must warn for exactly these nodes.
  it("true for a still-generating image (pending, no url)", () => {
    expect(isInFlightPaidGen({ type: "image", status: "pending" })).toBe(true);
  });
  it("true for a timed-out video (client gave up; job may still settle server-side)", () => {
    expect(isInFlightPaidGen({ type: "video", status: "timeout" })).toBe(true);
  });
  it("false once resolved to media (has url)", () => {
    expect(isInFlightPaidGen({ type: "image", status: "pending", url: "https://r2/x.png" })).toBe(false);
    expect(isInFlightPaidGen({ type: "video", status: "done", url: "https://tos/v.mp4" })).toBe(false);
  });
  it("false for a failed gen (terminal → already refunded, safe to delete)", () => {
    expect(isInFlightPaidGen({ type: "image", status: "failed" })).toBe(false);
  });
  it("false for a done-but-missing preview (terminal, not in-flight)", () => {
    expect(isInFlightPaidGen({ type: "video", status: "missing" })).toBe(false);
  });
  it("false for a text node (never paid)", () => {
    expect(isInFlightPaidGen({ type: "text", status: "pending" })).toBe(false);
  });
});

describe("createNodeWithRetry (F20)", () => {
  it("returns the node when createCanvasNode succeeds first try", async () => {
    m.createCanvasNode.mockResolvedValueOnce({ id: "n1" });
    const r = await createNodeWithRetry({ projectId: "p" } as never, 3);
    expect(r).toEqual({ id: "n1" });
    expect(m.createCanvasNode).toHaveBeenCalledTimes(1);
  });

  it("retries a THROWN createCanvasNode and succeeds (F20 — throws must not escape)", async () => {
    m.createCanvasNode
      .mockRejectedValueOnce(new Error("network blip"))
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ id: "n2" });
    const r = await createNodeWithRetry({ projectId: "p" } as never, 3);
    expect(r).toEqual({ id: "n2" });
    expect(m.createCanvasNode).toHaveBeenCalledTimes(3);
  });

  it("returns {error} (does NOT throw) when every attempt throws", async () => {
    m.createCanvasNode.mockRejectedValue(new Error("down"));
    const r = await createNodeWithRetry({ projectId: "p" } as never, 3);
    expect("error" in r).toBe(true);
    expect(m.createCanvasNode).toHaveBeenCalledTimes(3);
  });

  it("turns an unknown server-action response into an error instead of throwing", async () => {
    m.createCanvasNode.mockResolvedValue(undefined);
    const r = await createNodeWithRetry({ projectId: "p" } as never, 1);
    expect(r).toEqual({ error: "Unexpected response while placing the canvas card." });
  });
});

describe("startCanvasAction", () => {
  it("returns a validated accepted job", async () => {
    m.startCanvasGen.mockResolvedValue({ id: "job-1", disposition: "reused" });
    const fail = vi.fn();
    const outcome = vi.fn();
    await expect(startCanvasAction({ actionId: "a" }, fail, outcome)).resolves.toEqual({ id: "job-1", disposition: "reused" });
    expect(outcome).toHaveBeenCalledWith("accepted");
    expect(fail).not.toHaveBeenCalled();
  });

  it("reports returned, rejected, and unknown failures without leaking a rejection", async () => {
    const fail = vi.fn();
    const outcome = vi.fn();
    m.startCanvasGen.mockResolvedValueOnce({ error: "Thread not found." });
    await expect(startCanvasAction({ actionId: "a" }, fail, outcome)).resolves.toBeNull();
    expect(fail).toHaveBeenLastCalledWith("Thread not found.");
    expect(outcome).toHaveBeenLastCalledWith("rejected");

    m.startCanvasGen.mockRejectedValueOnce(new Error("network down"));
    await expect(startCanvasAction({ actionId: "a" }, fail, outcome)).resolves.toBeNull();
    expect(fail).toHaveBeenLastCalledWith("We couldn't confirm whether generation started — retry this same action.");
    expect(outcome).toHaveBeenLastCalledWith("unknown");

    m.startCanvasGen.mockResolvedValueOnce(undefined);
    await expect(startCanvasAction({ actionId: "a" }, fail, outcome)).resolves.toBeNull();
    expect(fail).toHaveBeenLastCalledWith("We couldn't confirm whether generation started — retry this same action.");
    expect(outcome).toHaveBeenLastCalledWith("unknown");
  });

  it("classifies an explicit dispatch refund separately from an outcome-unknown failure", async () => {
    const fail = vi.fn();
    const outcome = vi.fn();
    m.startCanvasGen.mockResolvedValueOnce({
      error: "The queue was unavailable. Your credits were refunded.",
      refunded: true,
    });

    await expect(startCanvasAction({ actionId: "a" }, fail, outcome)).resolves.toBeNull();

    expect(outcome).toHaveBeenCalledWith("refunded");
    expect(retainCanvasActionIdentity("refunded")).toBe(false);
    expect(retainCanvasActionIdentity("rejected")).toBe(false);
    expect(retainCanvasActionIdentity("accepted")).toBe(false);
    expect(retainCanvasActionIdentity("unknown")).toBe(true);
  });
});

describe("Canvas action recovery receipt", () => {
  const receipt: StoredCanvasActionReceipt = {
    version: 1,
    projectId: "project-1",
    actionId: "action-1",
    operation: "animate",
    prompt: "turn the product slowly",
    pos: { x: 10, y: 20, w: 320, h: 320 },
    model: "seedance-2-fast",
    approvedCredits: 8,
    threadId: "thread-1",
    sourceGenerationId: "gen-source",
    sourceNodeId: "node-source",
  };

  it("keeps exact action material across a same-tab refresh and clears only that action", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    saveCanvasActionReceipt(receipt);
    saveCanvasActionReceipt({ ...receipt, projectId: "project-2", actionId: "other" });

    expect(loadCanvasActionReceipts("project-1")).toEqual([receipt]);

    clearCanvasActionReceipt(receipt);
    expect(loadCanvasActionReceipts("project-1")).toEqual([]);
    expect(loadCanvasActionReceipts("project-2")).toHaveLength(1);
  });

  it("fails closed on malformed project receipt data instead of replaying or starting", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem("fikirtive:canvas-action:v1:project-1:bad", JSON.stringify({
      version: 1,
      projectId: "project-1",
      actionId: "bad",
      operation: "video",
    }));

    expect(loadCanvasActionReceipts("project-1")).toEqual([]);
    expect(claimCanvasActionReceipt(receipt)).toBe("recovery-unavailable");
  });

  it("does not let another project's malformed receipt block this project", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem("fikirtive:canvas-action:v1:project-2:bad", "not-json");

    expect(claimCanvasActionReceipt(receipt)).toBe("ok");
  });

  it("blocks a fresh paid action while an outcome-unknown receipt exists", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    expect(claimCanvasActionReceipt(receipt)).toBe("ok");
    expect(claimCanvasActionReceipt({ ...receipt, actionId: "fresh-action" }))
      .toBe("another-action-pending");
    expect(claimCanvasActionReceipt({ ...receipt, prompt: "changed material" }))
      .toBe("material-conflict");
    expect(loadCanvasActionReceipts("project-1")).toEqual([receipt]);
  });

  it("fails closed when session storage is unavailable or cannot retain the receipt", () => {
    expect(claimCanvasActionReceipt(receipt)).toBe("recovery-unavailable");

    const throwing = memoryStorage();
    throwing.setItem = () => { throw new Error("storage disabled"); };
    vi.stubGlobal("sessionStorage", throwing);
    expect(claimCanvasActionReceipt(receipt)).toBe("recovery-unavailable");
    expect(m.startCanvasGen).not.toHaveBeenCalled();
  });
});

describe("poll (F21)", () => {
  const cancelled = { current: false };
  beforeEach(() => { cancelled.current = false; });

  it("keeps polling past the old 48-iteration cap until a terminal status", async () => {
    // 60 RUNNING polls then DONE — the old fixed 48-cap would have reported 'failed'.
    let n = 0;
    m.getGenJob.mockImplementation(async () => (++n < 60 ? { status: "RUNNING", urls: [], generationIds: [] } : { status: "DONE", urls: ["u"], generationIds: ["g"] }));
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 200 });
    expect(onDone).toHaveBeenCalledWith(["u"], "done", ["g"]);
  });

  it("binds Canvas polling to the active project", async () => {
    m.getGenJob.mockResolvedValue({ status: "FAILED", urls: [], generationIds: [] });
    await poll("j", vi.fn(), cancelled, { projectId: "project-1", intervalMs: 0, maxPolls: 1 });
    expect(m.getGenJob).toHaveBeenCalledWith("j", "project-1");
  });

  it("reports a distinct 'timeout' (not 'failed') when the client gives up while still running", async () => {
    m.getGenJob.mockResolvedValue({ status: "RUNNING", urls: [], generationIds: [] });
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 3 });
    expect(onDone).toHaveBeenCalledWith([], "timeout", []);
  });

  it("reports 'failed' when the job actually FAILED", async () => {
    m.getGenJob.mockResolvedValue({ status: "FAILED", urls: [], generationIds: [] });
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 5 });
    expect(onDone).toHaveBeenCalledWith([], "failed", []);
  });

  it("reports 'missing' when the job is DONE but no media URL resolves", async () => {
    m.getGenJob.mockResolvedValue({ status: "DONE", urls: [], generationIds: ["g-missing"] });
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 5 });
    expect(onDone).toHaveBeenCalledWith([], "missing", ["g-missing"]);
  });

  it("reports 'timeout' when the job lookup returns null instead of leaving the card pending", async () => {
    m.getGenJob.mockResolvedValue(null);
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 5 });
    expect(onDone).toHaveBeenCalledWith([], "timeout", []);
  });

  it("reports 'timeout' when the job lookup throws instead of leaving an unhandled poll rejection", async () => {
    m.getGenJob.mockRejectedValue(new Error("session expired"));
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 5 });
    expect(onDone).toHaveBeenCalledWith([], "timeout", []);
  });

  it("stops without calling onDone when cancelled", async () => {
    cancelled.current = true;
    m.getGenJob.mockResolvedValue({ status: "RUNNING", urls: [], generationIds: [] });
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 5 });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports the worker's real progress on every successful status lookup", async () => {
    m.getGenJob
      .mockResolvedValueOnce({ status: "GENERATING", progress: 37, urls: [], generationIds: [] })
      .mockResolvedValueOnce({ status: "DONE", progress: 100, urls: ["u"], generationIds: ["g"] });
    const onDone = vi.fn();
    const onProgress = vi.fn();

    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 3, onProgress });

    expect(onProgress).toHaveBeenNthCalledWith(1, 37, "GENERATING");
    expect(onProgress).toHaveBeenNthCalledWith(2, 100, "DONE");
  });

  it("normalizes missing, non-finite, and out-of-range progress safely", async () => {
    m.getGenJob
      .mockResolvedValueOnce({ status: "GENERATING", progress: null, urls: [], generationIds: [] })
      .mockResolvedValueOnce({ status: "GENERATING", progress: Number.NaN, urls: [], generationIds: [] })
      .mockResolvedValueOnce({ status: "DONE", progress: 160, urls: ["u"], generationIds: ["g"] });
    const onProgress = vi.fn();

    await poll("j", vi.fn(), cancelled, { intervalMs: 0, maxPolls: 3, onProgress });

    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0, 0, 100]);
  });
});
