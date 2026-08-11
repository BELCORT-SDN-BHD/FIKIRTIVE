import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDeadLetters = vi.fn();
vi.mock("@/lib/dlq-watch", () => ({ checkDeadLetters: () => checkDeadLetters() }));

const { GET } = await import("../route");

const census = (over: Partial<{ healthy: boolean; total: number }> = {}) => ({
  healthy: true,
  total: 0,
  offenders: [],
  missing: [],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/ops/dlq", () => {
  it("answers 200 clear when no job has been dead-lettered", async () => {
    checkDeadLetters.mockResolvedValue(census());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deadLetters: "clear" });
  });

  // 状态码即告警:任何免费 uptime 探针零配置就能用,不需要关键字匹配。
  it("answers 503 backed-up when a job has been dead-lettered", async () => {
    checkDeadLetters.mockResolvedValue(
      census({ healthy: false, total: 2 }),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, deadLetters: "backed-up" });
  });

  it("answers 503 unknown when the queue itself cannot be reached", async () => {
    checkDeadLetters.mockRejectedValue(new Error("pg-boss handle is cooling down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, deadLetters: "unknown" });
  });

  // 免鉴权路由:外面读得到的只能是 clear/backed-up/unknown 三个字,别的一概不给。
  it("leaks no counts, queue names or error detail", async () => {
    checkDeadLetters.mockResolvedValue(
      census({ healthy: false, total: 7 }),
    );
    const body = await (await GET()).text();
    expect(body).not.toMatch(/\d/);
    expect(body).not.toContain("dlq");

    checkDeadLetters.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    const errorBody = await (await GET()).text();
    expect(errorBody).not.toContain("ECONNREFUSED");
    expect(errorBody).not.toContain("5432");
  });
});
