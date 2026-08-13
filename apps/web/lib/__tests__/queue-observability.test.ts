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
  classifyFailureReason,
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
    expect(board.connectionDetail).toContain("rejected the configured credential");
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

  it("refuses to say clear when no core reading came back", () => {
    const verdict = board({ duration: [{ label: null, value: 12 }] }).verdict;

    expect(verdict.state).toBe("unknown");
    expect(verdict.detail).toContain("Check the metrics wiring");
  });

  /**
   * #779 judge r1, P1 — the three shapes the judge reproduced against the first cut, where a
   * PARTIALLY absent core reading was summed as zero and the page announced
   * "Queue is clear — 0 jobs waiting". A mistyped metric name produces exactly this, so the
   * bug hid the very condition it was caused by.
   */
  describe("partial absence is never an all-clear", () => {
    it("both depth readings absent, wait 5s → unknown, naming both", () => {
      const verdict = board({ queueWait: [{ label: null, value: 5 }] }).verdict;

      expect(verdict.state).toBe("unknown");
      expect(verdict.headline).toBe("Queue health is unknown");
      expect(verdict.detail).toContain("jobs waiting to start");
      expect(verdict.detail).toContain("jobs queued behind others");
      expect(verdict.detail).not.toContain("0 jobs waiting");
    });

    it("pending absent, queued 0, wait 5s → unknown, naming the missing one only", () => {
      const verdict = board({
        queued: [{ label: null, value: 0 }],
        queueWait: [{ label: null, value: 5 }],
      }).verdict;

      expect(verdict.state).toBe("unknown");
      expect(verdict.detail).toContain("jobs waiting to start");
      expect(verdict.detail).not.toContain("jobs queued behind others");
    });

    it("wait absent while both depths are zero → still unknown, not clear", () => {
      const verdict = board({
        pending: [{ label: null, value: 0 }],
        queued: [{ label: null, value: 0 }],
      }).verdict;

      expect(verdict.state).toBe("unknown");
      expect(verdict.detail).toContain("queue wait time");
    });

    it("no output line disguises an absent reading as a zero", () => {
      for (const samples of [
        { queueWait: [{ label: null, value: 5 }] },
        { queued: [{ label: null, value: 0 }], queueWait: [{ label: null, value: 5 }] },
        { pending: [{ label: null, value: 0 }], queued: [{ label: null, value: 0 }] },
      ] satisfies MetricSamples[]) {
        const verdict = board(samples).verdict;
        expect(verdict.state).not.toBe("clear");
        expect(verdict.detail).not.toMatch(/\b0 jobs waiting\b/);
      }
    });

    /** A warning is positive evidence and must NOT be softened into "unknown" by a missing
     *  sibling — a partial read may only ever make the verdict worse, never better. */
    it("still warns on a threshold that was actually crossed, and says the count is a floor", () => {
      const verdict = board({ pending: [{ label: null, value: 25 }] }).verdict;

      expect(verdict.state).toBe("building");
      expect(verdict.detail).toContain("at least 25 jobs waiting");
    });

    it("still calls it backed up on a crossed wait threshold with both depths absent", () => {
      const verdict = board({ queueWait: [{ label: null, value: 900 }] }).verdict;

      expect(verdict.state).toBe("backedUp");
    });

    it("says the complete count plainly when nothing is missing", () => {
      const verdict = board({
        pending: [{ label: null, value: 1 }],
        queued: [{ label: null, value: 2 }],
        queueWait: [{ label: null, value: 3 }],
      }).verdict;

      expect(verdict.state).toBe("clear");
      expect(verdict.detail).toContain("3 jobs waiting");
      expect(verdict.detail).not.toContain("at least");
    });
  });

  it("keeps an empty result set as `no samples`, never as zero", () => {
    const rows = board({ pending: [], queued: [{ label: null, value: 0 }], queueWait: [{ label: null, value: 1 }] }).rows;
    const by = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(by.pending.value).toBeNull();
    expect(by.pending.detail).toContain("not the same as zero");
    expect(by.queued.value).toBe("0");
  });
});

/**
 * #779 judge r1, P2-1 — the fence the judge asked for: build an upstream response out of the
 * exact strings their read-only probe observed, and assert the PAGE OUTPUT has zero hits.
 *
 * The first cut leaned on the redactor, which is a deny list; "Volcengine quota exceeded: 7"
 * and "VMP query refused" were not on it and rendered verbatim. Upstream text is no longer
 * rendered at all, so these assertions hold for names nobody has thought of yet.
 */
describe("#779 white-label discipline", () => {
  /** Every supplier-side token that must never reach the screen, whole-word so an ordinary
   *  English word ("ark") stays legal in a future product label. */
  const SUPPLIER_TOKENS = [
    "seedance", "seedream", "byteplus", "bytedance", "jimeng",
    "volcengine", "volc", "vmp", "ark", "prometheus",
  ];

  function expectNoSupplierNames(board: unknown) {
    const rendered = JSON.stringify(board).toLowerCase();
    for (const name of SUPPLIER_TOKENS) {
      expect(rendered, `supplier token "${name}" reached the page`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  }

  it("classifies failure reasons into a closed vocabulary instead of quoting them", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("task_failure_distribution")) {
        return vector([
          { labels: { reason: "Volcengine quota exceeded" }, value: 7 },
          { labels: { reason: "seedance upstream refused" }, value: 2 },
          { labels: { reason: "content policy violation" }, value: 4 },
        ]);
      }
      return vector([{ value: 1 }]);
    });

    const board = await getQueueObservability({ queryUrl: QUERY_URL });
    const failures = board.rows.find((row) => row.id === "failureDistribution");

    expect(failures?.value).toBe("13");
    expect(failures?.detail).toContain("Hit a capacity limit: 7");
    expect(failures?.detail).toContain("Blocked by content rules: 4");
    expect(failures?.detail).not.toContain("quota exceeded");
    expectNoSupplierNames(board);
  });

  it("buckets an unrecognised reason as `Other` rather than passing it through", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("task_failure_distribution")) {
        return vector([{ labels: { reason: "gizmo flux desaturation" }, value: 3 }]);
      }
      return vector([{ value: 1 }]);
    });

    const board = await getQueueObservability({ queryUrl: QUERY_URL });
    const failures = board.rows.find((row) => row.id === "failureDistribution");

    expect(failures?.detail).toBe("Other: 3");
    expect(failures?.detail).not.toContain("gizmo");
    // The raw wording is kept where it is useful and harmless: the server log.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unclassified failure reasons"), ["gizmo flux desaturation"]);
    warn.mockRestore();
  });

  it("classifies every shape without ever echoing its input", () => {
    const CLOSED_SET = [
      "Blocked by content rules", "Hit a capacity limit", "Timed out", "Credential rejected",
      "Invalid request", "Network fault", "Upstream service error", "Cancelled upstream", "Other",
    ];
    for (const raw of [
      "Volcengine quota exceeded", "VMP query refused", "ark api 500", "prometheus write failed",
      "seedream nsfw block", "socket reset by peer", "signature mismatch", "task aborted by user",
      "totally novel supplier wording nobody predicted",
    ]) {
      expect(CLOSED_SET).toContain(classifyFailureReason(raw));
    }
  });

  it("describes a failed read by its shape, never by what the other side said", async () => {
    for (const [status, expected] of [
      [401, "rejected the configured credential"],
      [404, "no such workspace or query path"],
      [429, "rate limiting these reads"],
      [503, "reported an internal error"],
      [400, "rejected the query"],
    ] as const) {
      mockFetch.mockResolvedValue({
        ok: false,
        status,
        // A body naming the supplier, which is what an error body most often does.
        json: async () => ({ error: "VMP: Volcengine query refused" }),
      } as unknown as Response);

      const board = await getQueueObservability({ queryUrl: QUERY_URL });

      expect(board.connection).toBe("unavailable");
      expect(board.connectionDetail).toContain(expected);
      expectNoSupplierNames(board);
    }
  });

  it("never names a supplier in any label the page renders", () => {
    expectNoSupplierNames(
      buildQueueBoard({ connection: "notConfigured", connectionDetail: "unset", generatedAt: "2026-08-12T00:00:00.000Z" }),
    );
  });
});

/**
 * #779 judge r1, P2-2 — `Promise.all` rejects on the first failure while the other nine
 * requests are still open. The first cut cleared the shared timer without aborting, so those
 * nine had nothing left to settle them and every refresh of a failing page opened ten more.
 */
describe("#779 a failed read leaves nothing in flight", () => {
  it("aborts every outstanding request when one of them fails", async () => {
    const signals: AbortSignal[] = [];
    mockFetch.mockImplementation((url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      if (url.includes("task_pending")) {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({}) } as unknown as Response);
      }
      // Everything else behaves like a real slow request: it settles only on abort.
      return new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const board = await getQueueObservability({ queryUrl: QUERY_URL });

    expect(board.connection).toBe("unavailable");
    expect(signals).toHaveLength(QUEUE_METRIC_IDS.length);
    expect(signals.filter((signal) => signal.aborted)).toHaveLength(QUEUE_METRIC_IDS.length);
  });

  it("leaves no timer or open request behind on the success path either", async () => {
    const signals: AbortSignal[] = [];
    mockFetch.mockImplementation(async (_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return vector([{ value: 1 }]);
    });

    const board = await getQueueObservability({ queryUrl: QUERY_URL });

    expect(board.connection).toBe("connected");
    // Aborting after every request has settled is a no-op for the result, and is what
    // guarantees the shared controller is never left live.
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
