/**
 * refgen-error-sanitization.test.ts — refgen handler errors can contain presigned
 * media URLs (provider download failures, subprocess argv, storage URLs). Anything
 * persisted to RefGenJob.error or rethrown to pg-boss must be scrubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const refGenJobFindUnique = vi.fn();
  const refGenJobUpdate = vi.fn();
  const refGenJobUpdateMany = vi.fn();
  const entityFindFirst = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generate = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refGenJob: { findUnique: refGenJobFindUnique, update: refGenJobUpdate, updateMany: refGenJobUpdateMany },
    entity: { findFirst: entityFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, refGenJobFindUnique, refGenJobUpdate, refGenJobUpdateMany, entityFindFirst, refundReservation, settleCredits, generate };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, Prisma: {} }));
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "fal", generate: m.generate } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));

import { handleRefGen } from "./refgen.js";

const signedUrl = "https://r2.example/u/o1/asset.png?X-Amz-Credential=abc&X-Amz-Signature=secret";
const rawMessage = `provider download failed: ${signedUrl}`;
const job = {
  id: "rj1",
  ownerId: "o1",
  entityId: "e1",
  status: "QUEUED",
  mode: "BASE",
  model: "seedream",
  prompt: "make refs",
  count: 1,
  variantId: null,
  outputAssetIds: [],
  spentUsd: null,
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  m.refGenJobFindUnique.mockResolvedValue(job);
  m.entityFindFirst.mockResolvedValue({ id: "e1", baseAssetId: null });
  m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
  m.refGenJobUpdate.mockResolvedValue({});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("handleRefGen — error sanitization", () => {
  it("scrubs signed URLs from terminal FAILED error, logs, and pg-boss rethrow", async () => {
    const err = new Error(rawMessage) as Error & { charged?: boolean };
    err.charged = true;
    m.generate.mockRejectedValue(err);

    let thrown: unknown;
    try {
      await handleRefGen({ refGenJobId: "rj1" }, 0);
    } catch (e) {
      thrown = e;
    }

    const failed = m.refGenJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failed?.[0].data.error).toContain("<redacted-url>");
    expect(failed?.[0].data.error).not.toContain("X-Amz-Signature");
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("<redacted-url>");
    expect((thrown as Error).message).not.toContain("X-Amz-Signature");
    expect(consoleError.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("X-Amz-Signature");
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "rj1" });
  });

  it("scrubs signed URLs from retry requeue error and pg-boss rethrow", async () => {
    m.generate.mockRejectedValue(new Error(rawMessage));

    let thrown: unknown;
    try {
      await handleRefGen({ refGenJobId: "rj1" }, 0);
    } catch (e) {
      thrown = e;
    }

    const requeue = m.refGenJobUpdateMany.mock.calls.at(-1)?.[0];
    expect(requeue.data).toMatchObject({ status: "QUEUED" });
    expect(requeue.data.error).toContain("<redacted-url>");
    expect(requeue.data.error).not.toContain("X-Amz-Signature");
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("<redacted-url>");
    expect((thrown as Error).message).not.toContain("X-Amz-Signature");
    expect(m.refundReservation).not.toHaveBeenCalled();
  });
});
