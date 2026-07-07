// T4a render tracer (r2 mode): enqueue → worker renders via presigned inputs
// → output object in MinIO → /files 302 download → ftyp sanity check.
// Run from repo root: DATABASE_URL=... node scripts/tools/render-tracer.mjs
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
const { PgBoss } = await import(require.resolve("pg-boss"));
const { prisma } = await import("../../packages/db/dist/src/index.js");
const { fikirtiveEdit, RENDER_QUEUE, RENDER_DLQ, RENDER_QUEUE_POLICY, storageKeyToSrc, storageKey, newId } =
  await import("../../packages/core/dist/index.js");

const DB = process.env.DATABASE_URL ?? "postgresql://artlio:artlio@localhost:5432/artlio";
process.env.DATABASE_URL = DB;
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

// 1. pick an image asset from the smoke run
const asset = await prisma.asset.findFirst({ where: { ext: "png", deletedAt: null }, orderBy: { createdAt: "desc" } });
if (!asset) throw new Error("no png asset — run m0 smoke first");
const project = await prisma.project.findFirst({ orderBy: { createdAt: "desc" } });
const src = storageKeyToSrc(storageKey(asset.ownerId, asset.contentHash, asset.ext));
console.log(`✓ asset ${asset.id} → ${src}`);

// 2. minimal valid edit: one 2s image clip with fade in/out
const edit = fikirtiveEdit.parse({
  timeline: { tracks: [{ clips: [{
    asset: { type: "image", src },
    start: 0, length: 2,
    transition: { in: "fade", out: "fade" },
  }] }] },
  output: { format: "mp4", size: { width: 640, height: 360 } },
});

// 3. mirror startRender: row + boss.send
const job = await prisma.renderJob.create({
  data: { id: newId(), ownerId: asset.ownerId, projectId: project.id, editJson: edit },
});
const boss = new PgBoss({ connectionString: DB, supervise: false, schedule: false, max: 2 });
await boss.start();
await boss.createQueue(RENDER_DLQ).catch(() => {});
await boss.createQueue(RENDER_QUEUE, { ...RENDER_QUEUE_POLICY }).catch(() => {});
const qid = await boss.send(RENDER_QUEUE, { renderJobId: job.id });
console.log(`✓ enqueued render ${job.id} (queue job ${qid})`);

// 4. poll until DONE/FAILED
let row;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  row = await prisma.renderJob.findUnique({ where: { id: job.id } });
  if (row.status === "DONE" || row.status === "FAILED") break;
  if (i % 5 === 0) console.log(`  … ${row.status} ${row.progress ?? 0}%`);
}
if (row.status !== "DONE") throw new Error(`render ended ${row.status}: ${row.error}`);
console.log(`✓ render DONE → output asset ${row.outputAssetId}`);

// 5. authenticate (AUTH_ENABLED wall) via the dev magic-link flow
const jar = new Map();
const saveCookies = (res) =>
  res.headers.getSetCookie?.().forEach((c) => {
    const [kv] = c.split(";");
    const [k, ...v] = kv.split("=");
    jar.set(k.trim(), v.join("="));
  });
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
saveCookies(csrfRes);
const { csrfToken } = await csrfRes.json();
const signinRes = await fetch(`${BASE}/api/auth/signin/resend`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
  body: new URLSearchParams({ csrfToken, email: "tools@belcort.com" }),
  redirect: "manual",
});
saveCookies(signinRes);
const { readFile } = await import("node:fs/promises");
const magic = (await readFile(new URL("../.data/last-magic-link.txt", import.meta.url), "utf8")).trim();
const cbRes = await fetch(magic, { headers: { cookie: cookieHeader() }, redirect: "manual" });
saveCookies(cbRes);
if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error("magic-link login failed");
console.log("✓ signed in via magic link (fetch flow)");

// 6. output object must exist in MinIO + download through /files redirect
const out = await prisma.asset.findUnique({ where: { id: row.outputAssetId } });
const outKey = storageKey(out.ownerId, out.contentHash, out.ext);
const res = await fetch(`${BASE}/files/${outKey}`, { redirect: "manual", headers: { cookie: cookieHeader() } });
if (res.status !== 302) throw new Error(`expected 302 from /files, got ${res.status}`);
const cc = res.headers.get("cache-control");
if (!/no-store/.test(cc ?? "")) throw new Error(`302 missing no-store cache-control: ${cc}`);
console.log(`✓ /files 302 redirect carries Cache-Control: ${cc}`);
const signed = res.headers.get("location");
const blob = await fetch(signed);
const buf = Buffer.from(await blob.arrayBuffer());
if (buf.subarray(4, 8).toString() !== "ftyp") throw new Error("downloaded bytes are not mp4");
console.log(`✓ presigned download OK — mp4 ftyp box present, ${buf.length} bytes`);

await boss.stop();
await prisma.$disconnect();
console.log("RENDER TRACER PASSED (r2 mode)");
process.exit(0);
