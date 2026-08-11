import { describe, expect, it } from "vitest";
import {
  DEAD_LETTER_QUEUES,
  censusDeadLetters,
  deadLetterAlertTitle,
  type DeadLetterQueueRow,
} from "./dead-letters.js";
import { INGEST_QUEUE, INGEST_DLQ, RENDER_QUEUE_POLICY, CAPTION_QUEUE_POLICY } from "./timeline.js";
import { REFGEN_QUEUE_POLICY } from "./refgen.js";
import { GEN_QUEUE_POLICY, RESEARCH_QUEUE_POLICY } from "./gen.js";
import { PUBLISH_QUEUE_POLICY } from "./publish.js";

const row = (name: string, over: Partial<DeadLetterQueueRow> = {}): DeadLetterQueueRow => ({
  name,
  queuedCount: 0,
  deferredCount: 0,
  activeCount: 0,
  ...over,
});

const all = (over: Record<string, Partial<DeadLetterQueueRow>> = {}) =>
  DEAD_LETTER_QUEUES.map((name) => row(name, over[name]));

describe("DEAD_LETTER_QUEUES", () => {
  // 这条是名单的活体校验:任何一条队列策略新增或改了 deadLetter,名单没跟上就红。
  it("covers the deadLetter target of every queue policy that has one", () => {
    const declared = [
      RENDER_QUEUE_POLICY.deadLetter,
      CAPTION_QUEUE_POLICY.deadLetter,
      REFGEN_QUEUE_POLICY.deadLetter,
      GEN_QUEUE_POLICY.deadLetter,
      RESEARCH_QUEUE_POLICY.deadLetter,
      PUBLISH_QUEUE_POLICY.deadLetter,
    ];
    for (const target of declared) expect(DEAD_LETTER_QUEUES).toContain(target);
  });

  // ingest 的策略写在 worker 启动代码里(web 不产 ingest 队列),所以名字在这里对齐。
  it("names the ingest dead-letter queue the same way the worker creates it", () => {
    expect(INGEST_DLQ).toBe(`${INGEST_QUEUE}.dlq`);
    expect(INGEST_DLQ).toBe("ingest.dlq");
  });

  it("lists seven distinct queues", () => {
    expect(DEAD_LETTER_QUEUES).toHaveLength(7);
    expect(new Set<string>(DEAD_LETTER_QUEUES).size).toBe(7);
  });
});

describe("censusDeadLetters", () => {
  it("is healthy when all seven queues exist and are empty", () => {
    expect(censusDeadLetters(all())).toEqual({
      healthy: true,
      total: 0,
      offenders: [],
      missing: [],
    });
  });

  it("counts queued, deferred and active jobs as depth", () => {
    const census = censusDeadLetters(all({ "gen.dlq": { queuedCount: 2, deferredCount: 1, activeCount: 3 } }));
    expect(census.healthy).toBe(false);
    expect(census.total).toBe(6);
    expect(census.offenders).toEqual([{ queue: "gen.dlq", count: 6 }]);
  });

  it("sorts offenders by depth, then by name", () => {
    const census = censusDeadLetters(
      all({
        "gen.dlq": { queuedCount: 1 },
        "publish.dlq": { queuedCount: 5 },
        "caption.dlq": { queuedCount: 1 },
      }),
    );
    expect(census.offenders).toEqual([
      { queue: "publish.dlq", count: 5 },
      { queue: "caption.dlq", count: 1 },
      { queue: "gen.dlq", count: 1 },
    ]);
  });

  it("reports a queue pg-boss did not return as missing, and stays healthy", () => {
    const rows = all().filter((r) => r.name !== INGEST_DLQ);
    const census = censusDeadLetters(rows);
    expect(census.missing).toEqual([INGEST_DLQ]);
    expect(census.healthy).toBe(true);
  });

  it("ignores queues outside the dead-letter list", () => {
    const census = censusDeadLetters([...all(), row("gen", { queuedCount: 900 })]);
    expect(census.total).toBe(0);
    expect(census.healthy).toBe(true);
  });

  it("ignores a duplicated row instead of double counting it", () => {
    const census = censusDeadLetters([row("gen.dlq", { queuedCount: 4 }), row("gen.dlq", { queuedCount: 4 })]);
    expect(census.total).toBe(4);
  });

  it("treats malformed counts as zero rather than throwing", () => {
    const census = censusDeadLetters([
      row("gen.dlq", { queuedCount: Number.NaN, deferredCount: -3, activeCount: 2.7 }),
    ]);
    expect(census.total).toBe(2);
  });
});

describe("deadLetterAlertTitle", () => {
  // 标题稳定 = Sentry 分组稳定 = alert rule 不会因为条数变化重复轰炸。
  it("names the offending queues but never the counts", () => {
    const one = censusDeadLetters(all({ "gen.dlq": { queuedCount: 1 } }));
    const many = censusDeadLetters(all({ "gen.dlq": { queuedCount: 42 } }));
    expect(deadLetterAlertTitle(one)).toBe("Dead-letter queues are not empty: gen.dlq");
    expect(deadLetterAlertTitle(many)).toBe(deadLetterAlertTitle(one));
  });

  it("lists every offending queue", () => {
    const census = censusDeadLetters(all({ "gen.dlq": { queuedCount: 2 }, "render.dlq": { queuedCount: 9 } }));
    expect(deadLetterAlertTitle(census)).toBe("Dead-letter queues are not empty: render.dlq, gen.dlq");
  });
});
