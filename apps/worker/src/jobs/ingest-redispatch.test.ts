/**
 * ingest-redispatch.test.ts — F41(c): finalize commits Asset+Generation rows
 * BEFORE the ingest dispatch; a boss.send failure used to leave the asset
 * unverified forever (client-claimed hash, no probe metadata). The reaper now
 * re-dispatches ingest for UPLOAD assets whose probe metadata is still all-null
 * after a grace window. Idempotent by construction (ingest writes the same
 * values twice) and bounded by an age ceiling so a permanently-unprobeable
 * asset doesn't re-dispatch forever.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const assetFindMany = vi.fn();
  return { prisma: { asset: { findMany: assetFindMany } }, assetFindMany };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("../storage.js", () => ({ storage: {} }));

import {
  redispatchLostIngest,
  INGEST_REDISPATCH_MIN_AGE_MS,
  INGEST_REDISPATCH_MAX_AGE_MS,
} from "./ingest.js";

const NOW = new Date("2026-07-02T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("redispatchLostIngest", () => {
  it("re-dispatches each unverified UPLOAD asset and returns the count", async () => {
    m.assetFindMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    const send = vi.fn().mockResolvedValue("job-id");
    const n = await redispatchLostIngest(send, NOW);
    expect(n).toBe(2);
    expect(send).toHaveBeenCalledWith("a1");
    expect(send).toHaveBeenCalledWith("a2");
  });

  it("selects only live UPLOAD assets with all-null probe metadata inside the age window", async () => {
    m.assetFindMany.mockResolvedValue([]);
    await redispatchLostIngest(vi.fn(), NOW);
    const where = m.assetFindMany.mock.calls[0]![0].where;
    // GENERATED assets never get ingest jobs — sweeping them would re-dispatch forever
    expect(where.source).toBe("UPLOAD");
    expect(where.deletedAt).toBeNull();
    expect(where.width).toBeNull();
    expect(where.height).toBeNull();
    expect(where.durationS).toBeNull();
    // grace window: old enough that the original dispatch is truly lost,
    // young enough that a dead probe doesn't re-dispatch forever
    expect(where.createdAt.lt).toEqual(new Date(NOW.getTime() - INGEST_REDISPATCH_MIN_AGE_MS));
    expect(where.createdAt.gt).toEqual(new Date(NOW.getTime() - INGEST_REDISPATCH_MAX_AGE_MS));
  });

  it("returns 0 and sends nothing when every upload is verified", async () => {
    m.assetFindMany.mockResolvedValue([]);
    const send = vi.fn();
    expect(await redispatchLostIngest(send, NOW)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
