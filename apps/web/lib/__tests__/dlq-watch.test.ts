import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEAD_LETTER_QUEUES } from "@fikirtive/core";

const getQueues = vi.fn();
const getBoss = vi.fn(async () => ({ getQueues }));
const captureMessage = vi.fn();

vi.mock("@/lib/queue", () => ({ getBoss: () => getBoss() }));
vi.mock("@sentry/node", () => ({ captureMessage: (...args: unknown[]) => captureMessage(...args) }));

const emptyRows = () =>
  DEAD_LETTER_QUEUES.map((name) => ({ name, queuedCount: 0, deferredCount: 0, activeCount: 0 }));

/** 模块级缓存是被测行为的一部分,所以每个用例都拿一份全新模块。 */
async function loadFresh() {
  vi.resetModules();
  return import("@/lib/dlq-watch");
}

beforeEach(() => {
  vi.clearAllMocks();
  getBoss.mockImplementation(async () => ({ getQueues }));
  getQueues.mockResolvedValue(emptyRows());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkDeadLetters", () => {
  it("asks pg-boss for exactly the seven dead-letter queues", async () => {
    const { checkDeadLetters } = await loadFresh();
    await checkDeadLetters(1_000);
    expect(getQueues).toHaveBeenCalledWith([...DEAD_LETTER_QUEUES]);
  });

  it("is healthy when every dead-letter queue is empty", async () => {
    const { checkDeadLetters } = await loadFresh();
    const census = await checkDeadLetters(1_000);
    expect(census.healthy).toBe(true);
    expect(census.total).toBe(0);
  });

  it("is unhealthy and names the offender when a job was dead-lettered", async () => {
    getQueues.mockResolvedValue([
      ...emptyRows().filter((r) => r.name !== "gen.dlq"),
      { name: "gen.dlq", queuedCount: 2, deferredCount: 0, activeCount: 0 },
    ]);
    const { checkDeadLetters } = await loadFresh();
    const census = await checkDeadLetters(1_000);
    expect(census.healthy).toBe(false);
    expect(census.offenders).toEqual([{ queue: "gen.dlq", count: 2 }]);
  });

  // 免鉴权路由 + 每次都真查 = 谁都能拿它当 DB 压力源。
  it("serves a cached verdict inside the cache window instead of re-querying", async () => {
    const { checkDeadLetters, DEAD_LETTER_CACHE_MS } = await loadFresh();
    await checkDeadLetters(1_000);
    await checkDeadLetters(1_000 + DEAD_LETTER_CACHE_MS - 1);
    expect(getQueues).toHaveBeenCalledTimes(1);
  });

  it("re-queries once the cache window has passed", async () => {
    const { checkDeadLetters, DEAD_LETTER_CACHE_MS } = await loadFresh();
    await checkDeadLetters(1_000);
    await checkDeadLetters(1_000 + DEAD_LETTER_CACHE_MS);
    expect(getQueues).toHaveBeenCalledTimes(2);
  });

  it("propagates a queue failure instead of reporting a clean bill of health", async () => {
    getBoss.mockRejectedValue(new Error("pg-boss handle is cooling down"));
    const { checkDeadLetters } = await loadFresh();
    await expect(checkDeadLetters(1_000)).rejects.toThrow(/cooling down/);
  });

  it("does not cache a failed read", async () => {
    getBoss.mockRejectedValueOnce(new Error("down"));
    const { checkDeadLetters } = await loadFresh();
    await expect(checkDeadLetters(1_000)).rejects.toThrow();
    const census = await checkDeadLetters(1_000);
    expect(census.healthy).toBe(true);
  });
});

describe("dead-letter reporting", () => {
  const backedUp = () => [
    ...emptyRows().filter((r) => r.name !== "publish.dlq"),
    { name: "publish.dlq", queuedCount: 3, deferredCount: 0, activeCount: 0 },
  ];

  it("stays silent when no monitoring endpoint is configured", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    getQueues.mockResolvedValue(backedUp());
    const { checkDeadLetters } = await loadFresh();
    await checkDeadLetters(1_000);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("reports once per cache window, with counts in the payload and not the title", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    getQueues.mockResolvedValue(backedUp());
    const { checkDeadLetters, DEAD_LETTER_CACHE_MS } = await loadFresh();

    await checkDeadLetters(1_000);
    await checkDeadLetters(1_500); // inside the window — cached, so no second event
    expect(captureMessage).toHaveBeenCalledTimes(1);

    const [title, context] = captureMessage.mock.calls[0] as [string, Record<string, never>];
    expect(title).toBe("Dead-letter queues are not empty: publish.dlq");
    expect(title).not.toMatch(/\d/);
    expect(context).toMatchObject({
      level: "error",
      tags: { probe: "dead-letters" },
      extra: { total: 3, offenders: "publish.dlq=3" },
    });

    await checkDeadLetters(1_000 + DEAD_LETTER_CACHE_MS);
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("never reports a healthy census", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    const { checkDeadLetters } = await loadFresh();
    await checkDeadLetters(1_000);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  // 死信里躺的是商家的活。上报只说「哪条队列、几条」,不带 owner/org/job payload。
  it("sends no merchant identity or job payload", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.example/2");
    getQueues.mockResolvedValue(backedUp());
    const { checkDeadLetters } = await loadFresh();
    await checkDeadLetters(1_000);
    const serialized = JSON.stringify(captureMessage.mock.calls[0]);
    for (const forbidden of ["ownerId", "orgId", "email", "data", "payload"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
