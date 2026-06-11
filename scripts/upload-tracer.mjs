// T4b direct-upload tracer (r2 mode):
//   A. browser multipart — 66 MiB file through the real UploadZone (Uppy
//      parts → MinIO, finalize completes + HEAD-checks, candidate appears,
//      worker hash-verifies and keeps it)
//   B. forged hash — object planted under a key claiming the wrong sha256;
//      ingest must delete the object, soft-delete the asset, and log the
//      audit event (D19 rule 3 has teeth)
// Run from repo root with web (r2 mode, :3100) + worker + MinIO up.
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { writeFile, rm } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const DB = process.env.DATABASE_URL ?? "postgresql://artlio:artlio@localhost:5432/artlio";
process.env.DATABASE_URL = DB;
process.env.STORAGE_DRIVER = "r2";
process.env.R2_ENDPOINT ??= "http://localhost:9000";
process.env.R2_ACCESS_KEY_ID ??= "minioadmin";
process.env.R2_SECRET_ACCESS_KEY ??= "minioadmin";
process.env.R2_BUCKET ??= "artlio";

const { prisma } = await import("../packages/db/dist/src/index.js");
const { createStorage } = await import("../packages/storage/dist/index.js");
const core = await import("../packages/core/dist/index.js");
const { storageKey, newId, INGEST_QUEUE, UPLOAD_SINGLE_MAX_BYTES } = core;
const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const { PgBoss } = await import(require.resolve("pg-boss"));

const storage = createStorage("/tmp/unused");
const step = (msg) => console.log(`✓ ${msg}`);

/* ---------------- A. browser multipart upload ---------------- */

const BIG = UPLOAD_SINGLE_MAX_BYTES + 2 * 1024 * 1024; // 66 MiB → 2 parts
const bigFile = "/tmp/artlio-big-upload.mp4";
const bigBytes = randomBytes(BIG);
const bigHash = createHash("sha256").update(bigBytes).digest("hex");
await writeFile(bigFile, bigBytes);
step(`fixture: ${(BIG / 1024 / 1024).toFixed(0)} MiB random file, sha256 ${bigHash.slice(0, 12)}…`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));

// magic-link login via the dev link file
{
  const fs = await import("node:fs/promises");
  await page.goto(BASE + "/login");
  await page.locator('input[type="email"]').fill("tools@belcort.com");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
  const url = (await fs.readFile(".data/last-magic-link.txt", "utf8")).trim();
  await page.goto(url);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  step("signed in via magic link");
}

await page.setInputFiles('input[aria-label="Upload renders"]', bigFile);
// progress label proves the direct path is live (legacy path shows bare "Uploading…")
await page.getByText(/Uploading 1 file… \d+%/).waitFor({ timeout: 15000 });
step("progress label visible (direct path confirmed)");

// completion truth lives in the DB — leftover cards make UI waits ambiguous
let asset = null;
for (let i = 0; i < 120 && !asset; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  asset = await prisma.asset.findFirst({ where: { contentHash: bigHash } });
}
if (!asset) throw new Error("asset row never appeared for the multipart upload");
const gen = await prisma.generation.findFirst({ where: { assetId: asset.id } });
if (!gen) throw new Error("generation row missing for the multipart upload");
step("candidate row landed after multipart upload");
if (Number(asset.sizeBytes) !== BIG) throw new Error(`sizeBytes ${asset.sizeBytes} != ${BIG}`);
const key = storageKey(asset.ownerId, asset.contentHash, asset.ext);
const stored = await storage.sizeOf(key);
if (stored !== BIG) throw new Error(`stored object size ${stored} != ${BIG}`);
step(`asset row + object verified (${BIG} bytes, key ${key.slice(0, 40)}…)`);

// the worker's hash re-verify must KEEP a truthful upload
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const a = await prisma.asset.findUnique({ where: { id: asset.id } });
  if (a.deletedAt) throw new Error("hash verify wrongly deleted a truthful upload");
  if (a.width !== null || i === 29) break; // probe wrote metadata (or random bytes → probe failed, also fine)
}
const alive = await prisma.asset.findUnique({ where: { id: asset.id } });
if (alive.deletedAt) throw new Error("truthful upload was deleted");
step("worker hash re-verify kept the truthful upload");

await browser.close();
await rm(bigFile, { force: true });
if (consoleErrors.length) throw new Error(`page errors: ${consoleErrors.join(" | ")}`);

/* ---------------- B. forged-hash upload must die ---------------- */

const realBytes = randomBytes(1024);
const claimedHash = createHash("sha256").update(randomBytes(1024)).digest("hex"); // hash of DIFFERENT bytes
const owner = "founder";
const forgedKey = storageKey(owner, claimedHash, "png");
{
  // plant the object exactly as a lying client would: presigned PUT carries
  // the signed Content-Type + If-None-Match:* headers (single-shot write)
  const url = await storage.presignedPut(forgedKey, realBytes.length, 300);
  const res = await fetch(url, {
    method: "PUT",
    body: realBytes,
    headers: { "Content-Type": "image/png", "If-None-Match": "*" },
  });
  if (res.status !== 200) throw new Error(`forged PUT failed: ${res.status}`);
}
const forged = await prisma.asset.create({
  data: {
    id: newId(),
    ownerId: owner,
    contentHash: claimedHash,
    ext: "png",
    mime: "image/png",
    sizeBytes: BigInt(realBytes.length),
    originalFilename: "forged.png",
    source: "UPLOAD",
  },
});
// replay defense (codex round #1): the single-shot URL can't overwrite the
// object it just created — If-None-Match:* makes the second PUT fail
{
  const replayUrl = await storage.presignedPut(forgedKey, realBytes.length, 300);
  const replay = await fetch(replayUrl, {
    method: "PUT",
    body: randomBytes(realBytes.length), // same length, different bytes
    headers: { "Content-Type": "image/png", "If-None-Match": "*" },
  });
  if (replay.status === 200) throw new Error("REPLAY SUCCEEDED — If-None-Match not enforced");
  step(`replay overwrite rejected (${replay.status}) — single-shot URL holds`);
}

const boss = new PgBoss({ connectionString: DB, supervise: false, schedule: false, max: 2 });
await boss.start();
await boss.send(INGEST_QUEUE, { assetId: forged.id });
step("forged-hash asset planted + ingest dispatched");

let dead = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  dead = await prisma.asset.findUnique({ where: { id: forged.id } });
  if (dead.deletedAt) break;
}
if (!dead?.deletedAt) throw new Error("forged asset was NOT soft-deleted by hash re-verify");
if (await storage.exists(forgedKey)) throw new Error("forged object still in storage");
const audit = await prisma.actionEvent.findFirst({
  where: { type: "asset.hash_mismatch" },
  orderBy: { createdAt: "desc" },
});
if (!audit || audit.payload.assetId !== forged.id) throw new Error("hash_mismatch audit event missing");
step("forged upload deleted (object + row) with audit trail");

await boss.stop();
await prisma.$disconnect();
console.log("UPLOAD TRACER PASSED (multipart + hash re-verify)");
process.exit(0);
