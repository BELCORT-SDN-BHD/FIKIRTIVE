/**
 * /api/health 集成测试(真库)——外部监控的探测点(2026-07-04 盲区修复)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@fikirtive/db";
import { WORKER_STALE_MS } from "@/lib/health";
import { MIGRATION_STATUS_ENV } from "@/lib/boot-status";
import { GET } from "../route";

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany({});
});
afterEach(() => {
  delete process.env[MIGRATION_STATUS_ENV];
});

describe("GET /api/health", () => {
  it("db up + no heartbeat row → 200, worker unknown", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up", worker: "unknown", migrations: "applied" });
  });

  // #796: the web container now starts even when `prisma migrate deploy` could not run, because
  // an old-schema site beats a crash loop. This field is the safety belt on that choice — it is
  // the ONLY place a monitor can see that the site is serving on an un-migrated schema.
  it("boot said the migrations failed → still 200, but the body says so", async () => {
    process.env[MIGRATION_STATUS_ENV] = "failed";
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).migrations).toBe("failed");
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
