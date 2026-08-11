import "server-only";

import { redactProviderNames } from "@/lib/provider-secrecy";

/**
 * #779 — "is the generation queue backed up?", answered from the metrics store that was
 * provisioned for exactly this and then read by nobody.
 *
 * WHAT THIS IS NOT. It is not a collection layer. The nine queue metrics below plus the
 * webhook delivery rate are already produced and retained upstream of this app; the ticket's
 * whole point is that the store exists and nothing reads it. So this module only QUERIES —
 * it registers no counters, starts no timers, and writes nothing. Application-side monitoring
 * (health probe, Sentry, worker heartbeat) is a SEPARATE stack that keeps running unchanged;
 * these two coexist and neither replaces the other (docs/ops/incident-visibility.md).
 *
 * NO DATABASE. Nothing here reads a tenant row, so there is no tenant scope to get wrong:
 * every number is a platform-wide queue aggregate. The page that renders it still asserts
 * `system.read` on top of the founder-only admin shell.
 *
 * NO PROVIDER NAMES, EVER. The store is a supplier-side surface, and the product is
 * white-label: labels here are product language ("Waiting to start", "Delivery callbacks"),
 * the metric selectors never reach the screen, and any free text that comes back from the
 * store (a failure reason, an error message) goes through {@link redactProviderNames} before
 * it can be rendered.
 *
 * "NO SAMPLES" IS NOT "ZERO". A metric name we do not have exactly right, an expired
 * credential, and a genuinely empty queue all produce zero rows from the query API. Reporting
 * that as `0` would turn a broken dashboard into a confident all-clear — the single worst
 * failure mode an observability page has. Absence is therefore its own value (`value: null`),
 * rendered as "No samples", and the overall verdict refuses to say "clear" without the
 * evidence to say it.
 */

export type MetricTone = "neutral" | "info" | "success" | "warning" | "danger";

/** The nine queue metrics named in #779, plus the webhook delivery rate the same ticket asks
 *  for. Ids are ours; the selectors they map to live in {@link METRIC_CATALOG}. */
export type QueueMetricId =
  | "pending"
  | "queued"
  | "queueWait"
  | "concurrent"
  | "successRate"
  | "failureDistribution"
  | "cancelled"
  | "expired"
  | "duration"
  | "webhookRate";

type MetricUnit = "count" | "seconds" | "ratio" | "perMinute";

type MetricSpec = {
  id: QueueMetricId;
  /** Product language. This is what an operator reads; it never names a supplier. */
  label: string;
  help: string;
  unit: MetricUnit;
  /**
   * Metric name as #779 spells it, with `.` → `_` (a dot is not legal in a metric name).
   * A configured prefix is prepended, so a store that publishes these under a namespace is a
   * config change rather than a code change — and a name we have wrong shows as "No samples",
   * never as a zero.
   */
  metric: string;
  /** How multiple label series collapse into one number. Counts add up; rates average. */
  aggregate: "sum" | "avg";
  /** Only the failure metric is a breakdown; the rest are single numbers. */
  byLabel?: string;
};

const METRIC_CATALOG: readonly MetricSpec[] = [
  {
    id: "pending",
    label: "Waiting to start",
    help: "Accepted jobs that have not been picked up yet.",
    unit: "count",
    metric: "task_pending",
    aggregate: "sum",
  },
  {
    id: "queued",
    label: "Queued behind others",
    help: "Jobs holding a queue slot while earlier work finishes.",
    unit: "count",
    metric: "task_queued",
    aggregate: "sum",
  },
  {
    id: "queueWait",
    label: "Typical wait before start",
    help: "How long a job sits before it starts running.",
    unit: "seconds",
    metric: "task_queue_wait",
    aggregate: "avg",
  },
  {
    id: "concurrent",
    label: "Running right now",
    help: "Jobs executing concurrently.",
    unit: "count",
    metric: "task_concurrent",
    aggregate: "sum",
  },
  {
    id: "successRate",
    label: "Success rate",
    help: "Share of finished jobs that produced a result.",
    unit: "ratio",
    metric: "task_success_rate",
    aggregate: "avg",
  },
  {
    id: "failureDistribution",
    label: "Failures by reason",
    help: "What the failures were, grouped by reason.",
    unit: "count",
    metric: "task_failure_distribution",
    aggregate: "sum",
    byLabel: "reason",
  },
  {
    id: "cancelled",
    label: "Cancelled",
    help: "Jobs stopped before they finished.",
    unit: "count",
    metric: "task_cancelled",
    aggregate: "sum",
  },
  {
    id: "expired",
    label: "Expired in queue",
    help: "Jobs that timed out waiting instead of running.",
    unit: "count",
    metric: "task_expired",
    aggregate: "sum",
  },
  {
    id: "duration",
    label: "Typical run time",
    help: "How long a job takes once it starts.",
    unit: "seconds",
    metric: "task_duration",
    aggregate: "avg",
  },
  {
    id: "webhookRate",
    label: "Delivery callbacks",
    help: "Completion callbacks arriving per minute.",
    unit: "perMinute",
    metric: "webhook_rate",
    aggregate: "avg",
  },
] as const;

/** One reading of one metric. `label` is the breakdown key (failure reason) or null. */
export type MetricSample = { label: string | null; value: number };

/** Absent id, or an empty array, both mean "the store returned no samples" — see the header. */
export type MetricSamples = Partial<Record<QueueMetricId, MetricSample[]>>;

export type QueueMetricRow = {
  id: QueueMetricId;
  label: string;
  help: string;
  /** null means NO SAMPLES. It is never a stand-in for zero. */
  value: string | null;
  detail: string;
  tone: MetricTone;
};

export type QueueVerdict = {
  state: "clear" | "building" | "backedUp" | "unknown";
  headline: string;
  detail: string;
  tone: MetricTone;
};

export type QueueObservabilityBoard = {
  connection: "connected" | "notConfigured" | "unavailable";
  connectionDetail: string;
  verdict: QueueVerdict;
  rows: QueueMetricRow[];
  generatedAt: string;
};

/** Thresholds the verdict is made of. Named so the page and the tests read the same numbers. */
const DEPTH_WATCH = 20; // waiting + queued jobs
const WAIT_WATCH_SECONDS = 120;
const WAIT_BLOCKED_SECONDS = 600;
const SUCCESS_RATE_FLOOR = 0.9;

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_FAILURE_REASONS = 3;

export type QueueObservabilityEnv = {
  /** Full base URL of the metrics query API, workspace path included. Unset = not wired. */
  queryUrl?: string;
  /** `user:password` for basic auth. Optional: a store reachable without it simply omits it. */
  basicAuth?: string;
  /** Namespace in front of every metric name, when the store publishes one. */
  metricPrefix?: string;
  timeoutMs?: string;
};

type ResolvedConfig = { queryUrl: string; authHeader: string | null; metricPrefix: string; timeoutMs: number };

function readEnv(env: QueueObservabilityEnv): ResolvedConfig | null {
  const queryUrl = (env.queryUrl ?? "").trim().replace(/\/+$/, "");
  if (!queryUrl) return null;
  const basicAuth = (env.basicAuth ?? "").trim();
  const timeout = Number((env.timeoutMs ?? "").trim());
  return {
    queryUrl,
    authHeader: basicAuth ? `Basic ${Buffer.from(basicAuth).toString("base64")}` : null,
    metricPrefix: (env.metricPrefix ?? "").trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/** PromQL for one metric. Exported for the test that pins the `.` → `_` spelling. */
export function metricExpression(id: QueueMetricId, metricPrefix = ""): string {
  const spec = METRIC_CATALOG.find((entry) => entry.id === id);
  if (!spec) throw new Error(`unknown queue metric: ${id}`);
  const name = `${metricPrefix}${spec.metric}`;
  if (spec.byLabel) return `sum by (${spec.byLabel}) (${name})`;
  return `${spec.aggregate}(${name})`;
}

/** The ids this board reads, in display order. */
export const QUEUE_METRIC_IDS: readonly QueueMetricId[] = METRIC_CATALOG.map((spec) => spec.id);

/** Prometheus instant-query response, narrowed to the two fields this reads. */
function parseVector(body: unknown): MetricSample[] {
  const data = (body as { data?: { result?: unknown } } | null)?.data;
  const result = Array.isArray(data?.result) ? data.result : [];
  const samples: MetricSample[] = [];
  for (const entry of result) {
    const row = entry as { metric?: Record<string, string>; value?: [number, string] };
    const raw = Number(row.value?.[1]);
    if (!Number.isFinite(raw)) continue;
    const labels = row.metric ?? {};
    // The breakdown key, whatever the store called it. Free text from a supplier surface, so
    // it is redacted before it can ever be rendered.
    const label = labels.reason ?? labels.cause ?? labels.error ?? null;
    samples.push({ label: label ? redactProviderNames(label) : null, value: raw });
  }
  return samples;
}

async function queryOne(config: ResolvedConfig, spec: MetricSpec, signal: AbortSignal): Promise<MetricSample[]> {
  const url = `${config.queryUrl}/api/v1/query?query=${encodeURIComponent(metricExpression(spec.id, config.metricPrefix))}`;
  const response = await fetch(url, {
    signal,
    headers: config.authHeader ? { authorization: config.authHeader } : {},
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`metrics query returned HTTP ${response.status}`);
  return parseVector(await response.json());
}

function total(samples: MetricSample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null;
  return samples.reduce((sum, sample) => sum + sample.value, 0);
}

function average(samples: MetricSample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null;
  return samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length;
}

function reduceBy(spec: MetricSpec, samples: MetricSample[] | undefined): number | null {
  return spec.aggregate === "avg" ? average(samples) : total(samples);
}

function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatValue(unit: MetricUnit, value: number): string {
  if (unit === "seconds") return formatSeconds(value);
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (unit === "perMinute") return `${value.toFixed(1)}/min`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const NO_SAMPLES_DETAIL = "No samples returned — this is not the same as zero.";

function rowTone(id: QueueMetricId, value: number): MetricTone {
  if (id === "successRate") return value < SUCCESS_RATE_FLOOR ? "danger" : "success";
  if (id === "queueWait") {
    if (value >= WAIT_BLOCKED_SECONDS) return "danger";
    return value >= WAIT_WATCH_SECONDS ? "warning" : "success";
  }
  if (id === "expired") return value > 0 ? "warning" : "success";
  if (id === "failureDistribution") return value > 0 ? "warning" : "success";
  return "info";
}

function failureDetail(samples: MetricSample[] | undefined): string {
  const named = (samples ?? []).filter((sample) => sample.label);
  if (named.length === 0) return "No reason breakdown in the returned samples.";
  return named
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_FAILURE_REASONS)
    .map((sample) => `${sample.label}: ${formatValue("count", sample.value)}`)
    .join(" · ");
}

function buildRows(samples: MetricSamples): QueueMetricRow[] {
  return METRIC_CATALOG.map((spec) => {
    const readings = samples[spec.id];
    const value = reduceBy(spec, readings);
    if (value === null) {
      return { id: spec.id, label: spec.label, help: spec.help, value: null, detail: NO_SAMPLES_DETAIL, tone: "neutral" };
    }
    return {
      id: spec.id,
      label: spec.label,
      help: spec.help,
      value: formatValue(spec.unit, value),
      detail: spec.id === "failureDistribution" ? failureDetail(readings) : spec.help,
      tone: rowTone(spec.id, value),
    };
  });
}

/**
 * The one sentence the page exists to say.
 *
 * It will NOT say "clear" on missing evidence. Depth and wait are the two readings the
 * question is actually about; if neither came back, the honest answer is "unknown", and the
 * operator is told to check the wiring rather than told the queue is fine.
 */
function buildVerdict(samples: MetricSamples): QueueVerdict {
  const pending = total(samples.pending);
  const queued = total(samples.queued);
  const wait = average(samples.queueWait);
  const successRate = average(samples.successRate);
  const depth = pending === null && queued === null ? null : (pending ?? 0) + (queued ?? 0);

  if (depth === null && wait === null) {
    return {
      state: "unknown",
      headline: "Queue health is unknown",
      detail: "Neither queue depth nor wait time came back. Check the metrics wiring before reading anything below as reassurance.",
      tone: "warning",
    };
  }

  const blocked = (wait !== null && wait >= WAIT_BLOCKED_SECONDS) || (successRate !== null && successRate < SUCCESS_RATE_FLOOR);
  if (blocked) {
    return {
      state: "backedUp",
      headline: "Queue is backed up",
      detail:
        wait !== null && wait >= WAIT_BLOCKED_SECONDS
          ? `Jobs wait ${formatSeconds(wait)} before starting. Merchants are watching a spinner for that long.`
          : `Success rate is ${formatValue("ratio", successRate ?? 0)} — below the ${formatValue("ratio", SUCCESS_RATE_FLOOR)} floor.`,
      tone: "danger",
    };
  }

  const building = (wait !== null && wait >= WAIT_WATCH_SECONDS) || (depth !== null && depth >= DEPTH_WATCH);
  if (building) {
    return {
      state: "building",
      headline: "Queue is building up",
      detail: `${depth === null ? "Depth unknown" : `${depth} jobs waiting`}, typical wait ${wait === null ? "unknown" : formatSeconds(wait)}. Not blocked yet.`,
      tone: "warning",
    };
  }

  return {
    state: "clear",
    headline: "Queue is clear",
    detail: `${depth ?? 0} jobs waiting, typical wait ${wait === null ? "unknown" : formatSeconds(wait)}.`,
    tone: "success",
  };
}

/** Pure board assembly. Every state the page can show is reachable from here alone. */
export function buildQueueBoard(args: {
  connection: QueueObservabilityBoard["connection"];
  connectionDetail: string;
  samples?: MetricSamples;
  generatedAt: string;
}): QueueObservabilityBoard {
  const samples = args.connection === "connected" ? (args.samples ?? {}) : {};
  const verdict =
    args.connection === "connected"
      ? buildVerdict(samples)
      : {
          state: "unknown" as const,
          headline: "Queue health is unknown",
          detail: args.connectionDetail,
          tone: "warning" as const,
        };
  return {
    connection: args.connection,
    connectionDetail: args.connectionDetail,
    verdict,
    rows: buildRows(samples),
    generatedAt: args.generatedAt,
  };
}

const NOT_CONFIGURED_DETAIL =
  "The metrics query endpoint is not configured for this deployment, so nothing is being read. Set QUEUE_METRICS_QUERY_URL to switch this page on.";

/**
 * Read the store and build the board. NEVER THROWS: an observability page that 500s during an
 * incident is worse than one that says it cannot see. Every failure path degrades to
 * "unavailable" with a redacted reason, and the verdict degrades with it.
 */
export async function getQueueObservability(
  env: QueueObservabilityEnv = {
    queryUrl: process.env.QUEUE_METRICS_QUERY_URL,
    basicAuth: process.env.QUEUE_METRICS_BASIC_AUTH,
    metricPrefix: process.env.QUEUE_METRICS_PREFIX,
    timeoutMs: process.env.QUEUE_METRICS_TIMEOUT_MS,
  },
): Promise<QueueObservabilityBoard> {
  const generatedAt = new Date().toISOString();
  const config = readEnv(env);
  if (!config) {
    return buildQueueBoard({ connection: "notConfigured", connectionDetail: NOT_CONFIGURED_DETAIL, generatedAt });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    // All-or-nothing on purpose. A partial read is the misleading state this page must never
    // enter: nine green panels next to one silent failure reads as "fine", when the silent one
    // may be the only metric that was going to say otherwise.
    const settled = await Promise.all(
      METRIC_CATALOG.map(async (spec) => [spec.id, await queryOne(config, spec, controller.signal)] as const),
    );
    const samples: MetricSamples = {};
    for (const [id, readings] of settled) samples[id] = readings;
    return buildQueueBoard({
      connection: "connected",
      connectionDetail: `Read from the metrics store at ${generatedAt.slice(0, 16).replace("T", " ")} UTC.`,
      samples,
      generatedAt,
    });
  } catch (error) {
    // The URL carries the workspace path and the header carries the credential; neither may
    // reach the screen. Only the shape of the failure does.
    const reason = error instanceof Error && error.name === "AbortError"
      ? `the metrics store did not answer within ${config.timeoutMs}ms`
      : redactProviderNames(error instanceof Error ? error.message : "unknown error");
    return buildQueueBoard({
      connection: "unavailable",
      connectionDetail: `Could not read the metrics store — ${reason}. The queue itself may be perfectly healthy; this page simply cannot see it.`,
      generatedAt,
    });
  } finally {
    clearTimeout(timer);
  }
}
