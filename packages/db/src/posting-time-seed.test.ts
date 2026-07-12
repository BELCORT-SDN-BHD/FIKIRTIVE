/**
 * B0-103 — PostingTimeSeed table + seed tests (B4 block spec §2.2, report §③/§⑧).
 *
 * The cold-start posting-time seed is STATIC, GLOBAL, READ-ONLY craft knowledge (best windows to
 * post per channel) inserted by migration 20260713110000_posting_time_seed. It is deliberately NOT
 * owner-scoped, so the per-test Organization TRUNCATE (test/setup.ts) does NOT touch it — the seed
 * rows persist and are readable for everyone, before any user has history of their own.
 *
 * This asserts: (1) the migration seeded the expected rows and they read back ranked by score;
 * (2) there is no owner column (it is global, outside the tenant iron-curtain by design).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./index.js";

const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");

describe("B0-103 PostingTimeSeed — static seed read", () => {
  it("migration seeded posting-time rows for the current channels", async () => {
    const ig = await prisma.postingTimeSeed.findMany({ where: { channel: "instagram" } });
    const fb = await prisma.postingTimeSeed.findMany({ where: { channel: "facebook" } });
    expect(ig.length).toBeGreaterThanOrEqual(5);
    expect(fb.length).toBeGreaterThanOrEqual(4);
  });

  it("reads back ranked by score (best slot first) with a sane shape", async () => {
    const ranked = await prisma.postingTimeSeed.findMany({
      where: { channel: "instagram" },
      orderBy: { score: "desc" },
    });
    expect(ranked.length).toBeGreaterThan(0);
    const top = ranked[0]!;
    expect(top.dayOfWeek).toBeGreaterThanOrEqual(0);
    expect(top.dayOfWeek).toBeLessThanOrEqual(6);
    expect(top.hourUtc).toBeGreaterThanOrEqual(0);
    expect(top.hourUtc).toBeLessThanOrEqual(23);
    expect(top.rationale.length).toBeGreaterThan(0);
    // strictly non-increasing score (ranking invariant)
    for (let i = 1; i < ranked.length; i++) expect(ranked[i]!.score).toBeLessThanOrEqual(ranked[i - 1]!.score);
  });

  it("is a GLOBAL table (no ownerId column) — outside the tenant iron-curtain by design", () => {
    const src = fs.readFileSync(SCHEMA, "utf8");
    const start = src.indexOf("model PostingTimeSeed {");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = src.slice(start, src.indexOf("\n}", start));
    expect(block).not.toMatch(/^\s+ownerId\s/m);
  });
});
