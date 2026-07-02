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
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ createCanvasNode: vi.fn(), getGenJob: vi.fn(), startGen: vi.fn() }));
vi.mock("../canvas-actions", () => ({ createCanvasNode: m.createCanvasNode }));
vi.mock("../gen-actions", () => ({ getGenJob: m.getGenJob, startGen: m.startGen }));

import { createNodeWithRetry, poll } from "../../components/canvas/useCanvasGen";

beforeEach(() => vi.clearAllMocks());

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

  it("stops without calling onDone when cancelled", async () => {
    cancelled.current = true;
    m.getGenJob.mockResolvedValue({ status: "RUNNING", urls: [], generationIds: [] });
    const onDone = vi.fn();
    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 5 });
    expect(onDone).not.toHaveBeenCalled();
  });
});
