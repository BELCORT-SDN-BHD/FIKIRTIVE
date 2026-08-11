/**
 * #779 — the queue board's behaviour, with the metrics store mocked.
 *
 * The load-bearing assertions are the honesty ones: absence never renders as zero, a partial
 * or failed read never renders as "clear", and neither the workspace URL nor the credential
 * ever appears in anything the page is handed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildQueueBoard,
  getQueueObservability,
  metricExpression,
  QUEUE_METRIC_IDS,
  type MetricSamples,
} from "../queue-observability";

const QUERY_URL = "https://metrics.example.test/workspaces/ws-abc123";
const BASIC_AUTH = "probe:s3cr3t-value";

const mockFetch = vi.fn();

/** A Prometheus instant-query vector response. */
function vector(rows: Array<{ labels?: Record<string, string>; value: number }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "success",
      data: {
        resultType: "vector",
        result: rows.map((row) => ({ metric: row.labels ?? {}, value: [1_760_000_000, String(row.value)] })),
      },
    }),
  } as unknown as Response;
}

/** Answer every metric with the same single value; enough for the shape assertions. */
function answerAll(value: number) {
  mockFetch.mockImplementation(async () => vector([{ value }]));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#779 metric catalog", () => {
  it("covers the nine queue metrics plus the webhook delivery rate", () => {
    expect(QUEUE_METRIC_IDS).toEqual([
      "pending",
      "queued",
      "queueWait",
      "concurrent",
      "successRate",
      "failureDistribution",
      "cancelled",
      "expired",
      "duration",
      "webhookRate",
    ]);
  });

  it("spells each ticket name with `_` and honours a configured namespace", () => {
    expect(metricExpression("pending")).toBe("sum(task_pending)");
    expect(metricExpression("queueWait")).toBe("avg(task_queue_wait)");
    expect(metricExpression("failureDistribution")).toBe("sum by (reason) (task_failure_distribution)");
    expect(metricExpression("webhookRate", "gw_")).toBe("avg(gw_webhook_rate)");
  });
});

describe("#779 not configured", () => {
  it("reads nothing and says so instead of showing a reassuring zero", async () => {
    const board = await getQueueObservability({});

    expect(mockFetch).not.toHaveBeenCalled();
    expect(board.connection).toBe("notConfigured");
    expect(board.verdict.state).toBe("unknown");
    expect(board.rows).toHaveLength(QUEUE_METRIC_IDS.length);
    expect(board.rows.every((row) => row.value === null)).toBe(true);
  });
});

describe("#779 live read", () => {
  it("queries every metric once and maps the readings into product language", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("task_queue_wait")) return vector([{ value: 45 }]);
      if (url.includes("task_success_rate")) return vector([{ value: 0.985 }]);
      if (url.includes("task_duration")) return vector([{ value: 200 }]);
      if (url.includes("webhook_rate")) return vector([{ value: 12.25 }]);
      return vector([{ value: 3 }]);
    });

    const board = await getQueueObservability({ queryUrl: QUERY_URL });

    expect(mockFetch).toHaveBeenCalledTimes(QUEUE_METRIC_IDS.length);
    expect(board.connection).toBe("connected");
    const by = Object.fromEntries(board.rows.map((row) => [row.id, row]));
    expect(by.queueWait.value).toBe("45s");
    expect(by.duration.value).toBe("3m 20s");
    expect(by.successRate.value).toBe("98.5%");
    expect(by.webhookRate.value).toBe("12.3/min");
    expect(by.pending.value).toBe("3");
  });

  it("sends basic auth when configured, and keeps the credential out of the board", async () => {
    answerAll(1);

    const board = await getQueueObservability({ queryUrl: QUERY_URL, basicAuth: BASIC_AUTH });

    const headers = (mockFetch.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe(`Basic ${Buffer.from(BASIC_AUTH).toString("base64")}`);
    const rendered = JSON.stringify(board);
    expect(rendered).not.toContain("s3cr3t-value");
    expect(rendered).not.toContain(Buffer.from(BASIC_AUTH).toString("base64"));
    expect(rendered).not.toContain("ws-abc123");
  });

  it("omits the authorization header entirely when no credential is configured", async () => {
    answerAll(1);

    await getQueueObservability({ queryUrl: QUERY_URL });

    const headers = (mockFetch.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBeUndefined();
  });
});

describe("#779 the store cannot be read", () => {
  it("degrades to `unavailable` instead of throwing an admin 500", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);

    const board = await getQueueObservability({ queryUrl: QUERY_URL, basicAuth: BASIC_AUTH });

    expect(board.connection).toBe("unavailable");
    expect(board.connectionDetail).toContain("HTTP 401");
    expect(board.verdict.state).toBe("unknown");
    expect(board.rows.every((row) => row.value === null)).toBe(true);
    expect(JSON.stringify(board)).not.toContain("s3cr3t-value");
  });

  it("does not let one failed metric render as nine healthy ones", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("task_queue_wait")) throw new Error("connection reset");
      return vector([{ value: 0 }]);
    });

    const board = await getQueueObservability({ queryUrl: QUERY_URL });

    expect(board.connection).toBe("unavailable");
    expect(board.verdict.state).toBe("unknown");
  });
});

describe("#779 the verdict", () => {
  const at = "2026-08-12T00:00:00.000Z";
  const board = (samples: MetricSamples) =>
    buildQueueBoard({ connection: "connected", connectionDetail: "read", samples, generatedAt: at });

  it("says clear only when depth and wait are both small", () => {
    const verdict = board({
      pending: [{ label: null, value: 1 }],
      queued: [{ label: null, value: 2 }],
      queueWait: [{ label: null, value: 20 }],
      successRate: [{ label: null, value: 0.99 }],
    }).verdict;

    expect(verdict.state).toBe("clear");
    expect(verdict.headline).toBe("Queue is clear");
  });

  it("warns while the queue is building but not yet blocking", () => {
    const verdict = board({
      pending: [{ label: null, value: 18 }],
      queued: [{ label: null, value: 9 }],
      queueWait: [{ label: null, value: 30 }],
    }).verdict;

    expect(verdict.state).toBe("building");
    expect(verdict.detail).toContain("27 jobs waiting");
  });

  it("calls it backed up once merchants wait ten minutes to start", () => {
    const verdict = board({
      pending: [{ label: null, value: 4 }],
      queueWait: [{ label: null, value: 640 }],
    }).verdict;

    expect(verdict.state).toBe("backedUp");
    expect(verdict.tone).toBe("danger");
    expect(verdict.detail).toContain("10m 40s");
  });

  it("calls it backed up when the success rate falls through the floor", () => {
    const verdict = board({
      pending: [{ label: null, value: 0 }],
      queueWait: [{ label: null, value: 5 }],
      successRate: [{ label: null, value: 0.42 }],
    }).verdict;

    expect(verdict.state).toBe("backedUp");
    expect(verdict.detail).toContain("42.0%");
  });

  it("refuses to say clear when neither depth nor wait came back", () => {
    const verdict = board({ duration: [{ label: null, value: 12 }] }).verdict;

    expect(verdict.state).toBe("unknown");
    expect(verdict.detail).toContain("Check the metrics wiring");
  });

  it("keeps an empty result set as `no samples`, never as zero", () => {
    const rows = board({ pending: [], queued: [{ label: null, value: 0 }], queueWait: [{ label: null, value: 1 }] }).rows;
    const by = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(by.pending.value).toBeNull();
    expect(by.pending.detail).toContain("not the same as zero");
    expect(by.queued.value).toBe("0");
  });
});

describe("#779 white-label discipline", () => {
  it("redacts supplier names carried in a failure reason breakdown", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("task_failure_distribution")) {
        return vector([
          { labels: { reason: "seedance upstream refused" }, value: 7 },
          { labels: { reason: "content filter" }, value: 2 },
        ]);
      }
      return vector([{ value: 1 }]);
    });

    const board = await getQueueObservability({ queryUrl: QUERY_URL });
    const failures = board.rows.find((row) => row.id === "failureDistribution");

    expect(failures?.value).toBe("9");
    expect(failures?.detail).toContain("generation provider upstream refused: 7");
    expect(JSON.stringify(board).toLowerCase()).not.toContain("seedance");
  });

  it("never names a supplier in any label the page renders", () => {
    const rendered = JSON.stringify(
      buildQueueBoard({ connection: "notConfigured", connectionDetail: "unset", generatedAt: "2026-08-12T00:00:00.000Z" }),
    ).toLowerCase();

    // Whole words: "ark" must not appear as a supplier name, but must stay legal inside an
    // ordinary English word a future label might use.
    for (const name of ["seedance", "seedream", "byteplus", "bytedance", "jimeng", "ark", "volc", "prometheus"]) {
      expect(rendered).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
