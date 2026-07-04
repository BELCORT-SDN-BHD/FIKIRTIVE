/**
 * /api/health 集成测试(真库)——外部监控的探测点(2026-07-04 盲区修复)。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";
import { WORKER_STALE_MS } from "@/lib/health";
import { GET } from "../route";

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany({});
});

describe("GET /api/health", () => {
  it("db up + no heartbeat row → 200, worker unknown", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up", worker: "unknown" });
  });

  it("fresh heartbeat → worker up", async () => {
    await prisma.workerHeartbeat.create({ data: { id: "worker", at: new Date() } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).worker).toBe("up");
  });

  it("stale heartbeat (worker died) → worker stale, still 200 (web itself is up)", async () => {
    await prisma.workerHeartbeat.create({ data: { id: "worker", at: new Date(Date.now() - WORKER_STALE_MS - 1000) } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).worker).toBe("stale");
  });
});
