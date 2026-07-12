/**
 * B0-30 — ChannelConnection schema tests (B4 block spec §2.2, report §⑧/§⑩).
 *
 * Two invariants the spec freezes for the generic channel-connection layer:
 *   1. schema-migration test: the table exists with the expected columns, `kind` is an OPEN
 *      string (a non-Meta channel like "x" persists with no enum rejection), and rows are
 *      owner-scoped (宪法 6 铁幕 — a query filtered to another owner sees nothing).
 *   2. encrypted-column non-plaintext assertion: `accessTokenEnc` holds ciphertext, never the
 *      plaintext token; the model carries NO plaintext token column. We prove the column preserves
 *      real AES-256-GCM ciphertext (round-trips back to plaintext) and that the stored value is
 *      not the plaintext — the same crypto discipline MetaConnection.accessTokenEnc uses.
 *
 * Runs against a real *_test Postgres with migrations deployed (test/setup.ts truncates
 * Organization CASCADE each test, which clears ChannelConnection via its owner FK).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./index.js";

const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");
const ORG_A = "cc-org-a";
const ORG_B = "cc-org-b";

// Self-contained AES-256-GCM (mirrors @fikirtive/token-crypto's scheme) so this test proves the
// column holds/preserves REAL ciphertext without depending on prod key management.
const KEY = Buffer.alloc(32, 7);
function enc(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}
function dec(token: string): string {
  const [ivB, tagB, ctB] = token.split(".") as [string, string, string];
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB, "base64"));
  d.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB, "base64")), d.final()]).toString("utf8");
}

/** The ChannelConnection model block from schema.prisma. */
function channelConnectionBlock(): string {
  const src = fs.readFileSync(SCHEMA, "utf8");
  const start = src.indexOf("model ChannelConnection {");
  expect(start, "ChannelConnection model must exist in schema.prisma").toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf("\n}", start));
}

beforeEach(async () => {
  await prisma.organization.create({ data: { id: ORG_A } });
  await prisma.organization.create({ data: { id: ORG_B } });
});

describe("B0-30 ChannelConnection — encrypted-column discipline (schema shape)", () => {
  it("has an accessTokenEnc column and NO plaintext token column", () => {
    const block = channelConnectionBlock();
    expect(block).toMatch(/^\s+accessTokenEnc\s+String/m);
    // No plaintext token field: `accessToken`/`token`/`secret` WITHOUT the Enc suffix.
    expect(block).not.toMatch(/^\s+accessToken\s+String/m);
    expect(block).not.toMatch(/^\s+token\s+String/m);
    expect(block).not.toMatch(/^\s+secret\s+String/m);
  });

  it("kind is an OPEN string (not a closed enum) so a new channel needs no migration", () => {
    const block = channelConnectionBlock();
    expect(block).toMatch(/^\s+kind\s+String/m); // String, not an enum type
  });
});

describe("B0-30 ChannelConnection — DB migration + non-plaintext + owner-scope", () => {
  it("persists an encrypted token — stored value is ciphertext, never the plaintext, and round-trips", async () => {
    const plaintext = "EAAG-super-secret-page-access-token";
    await prisma.channelConnection.create({
      data: { id: "cc-1", ownerId: ORG_A, kind: "facebook", externalId: "pg-1", accessTokenEnc: enc(plaintext) },
    });
    const row = await prisma.channelConnection.findFirstOrThrow({ where: { id: "cc-1", ownerId: ORG_A } });
    expect(row.accessTokenEnc).not.toBe(plaintext); // never plaintext at rest
    expect(row.accessTokenEnc).not.toContain(plaintext);
    expect(dec(row.accessTokenEnc)).toBe(plaintext); // but decrypts back
  });

  it("is owner-scoped: another owner's filter never sees this owner's connection (铁幕)", async () => {
    await prisma.channelConnection.create({
      data: { id: "cc-2", ownerId: ORG_A, kind: "instagram", accessTokenEnc: enc("t") },
    });
    const leaked = await prisma.channelConnection.findMany({ where: { ownerId: ORG_B } });
    expect(leaked).toHaveLength(0);
    const own = await prisma.channelConnection.findMany({ where: { ownerId: ORG_A } });
    expect(own).toHaveLength(1);
  });

  it("accepts an open kind string beyond Meta (e.g. 'x') with no enum rejection", async () => {
    const row = await prisma.channelConnection.create({
      data: { id: "cc-3", ownerId: ORG_A, kind: "x", externalId: "u-9", accessTokenEnc: enc("t") },
    });
    expect(row.kind).toBe("x");
  });
});

describe("B0-30 ChannelConnection — single NULL default per (owner, kind) (NODE-275 收口1, partial unique)", () => {
  // Postgres UNIQUE treats NULLs as distinct, so the three-column unique CANNOT enforce the
  // "single default connection" promise on its own. These tests exercise the REAL partial index
  // ChannelConnection_one_default_per_owner_kind (WHERE "externalId" IS NULL) from the migration.
  it("rejects a SECOND NULL-externalId default for the same (owner, kind) with P2002", async () => {
    await prisma.channelConnection.create({
      data: { id: "cc-d1", ownerId: ORG_A, kind: "instagram", accessTokenEnc: enc("t") },
    });
    await expect(
      prisma.channelConnection.create({
        data: { id: "cc-d2", ownerId: ORG_A, kind: "instagram", accessTokenEnc: enc("t") },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("concurrent duplicate NULL defaults: exactly ONE insert wins, the loser fails P2002", async () => {
    const results = await Promise.allSettled([
      prisma.channelConnection.create({ data: { id: "cc-r1", ownerId: ORG_A, kind: "facebook", accessTokenEnc: enc("t") } }),
      prisma.channelConnection.create({ data: { id: "cc-r2", ownerId: ORG_A, kind: "facebook", accessTokenEnc: enc("t") } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as { code?: string }).code).toBe("P2002");
  });

  it("a NULL default coexists with BOUND (non-NULL externalId) connections of the same kind", async () => {
    await prisma.channelConnection.create({
      data: { id: "cc-n1", ownerId: ORG_A, kind: "instagram", accessTokenEnc: enc("t") },
    });
    await expect(
      prisma.channelConnection.create({
        data: { id: "cc-n2", ownerId: ORG_A, kind: "instagram", externalId: "acct-1", accessTokenEnc: enc("t") },
      }),
    ).resolves.toMatchObject({ id: "cc-n2" });
  });

  it("another owner or another kind may hold its own NULL default (distinct index key)", async () => {
    await prisma.channelConnection.create({
      data: { id: "cc-k1", ownerId: ORG_A, kind: "instagram", accessTokenEnc: enc("t") },
    });
    await expect(
      prisma.channelConnection.create({ data: { id: "cc-k2", ownerId: ORG_B, kind: "instagram", accessTokenEnc: enc("t") } }),
    ).resolves.toMatchObject({ id: "cc-k2" });
    await expect(
      prisma.channelConnection.create({ data: { id: "cc-k3", ownerId: ORG_A, kind: "facebook", accessTokenEnc: enc("t") } }),
    ).resolves.toMatchObject({ id: "cc-k3" });
  });
});
