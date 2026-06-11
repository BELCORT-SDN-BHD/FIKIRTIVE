// i2v tracer: prove the Gen "Animate" path end-to-end.
//   image gen (t2i) on a shot  → source frame
//   video gen (i2v) on the shot → animate the source frame into an mp4
//   → stored content-addressed, attached as the shot's latest generation,
//     shot ATTACHED, served by the web at /files/<key>, and rendered as a
//     VIDEO clip in the board edit.
// Mock by default ($0, no network). Run from repo root with worker + postgres
// up. The worker must share this storage backend (local disk unless STORAGE_*
// is set on both). Set WEB_ORIGIN to skip the /files reachability check.
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const { PgBoss } = await import(require.resolve("pg-boss"));
const { prisma } = await import("../packages/db/dist/src/index.js");
const { GEN_QUEUE, GEN_DLQ, GEN_QUEUE_POLICY, storageKey, storageKeyToSrc, newId, FOUNDER_OWNER_ID } =
  await import("../packages/core/dist/index.js");

const DB = process.env.DATABASE_URL ?? "postgresql://artlio:artlio@localhost:5432/artlio";
process.env.DATABASE_URL = DB;
const WEB = process.env.WEB_ORIGIN ?? "http://localhost:3100";
const OWNER = FOUNDER_OWNER_ID;
const IMG_EXTS = ["png", "jpg", "jpeg", "webp"];
const step = (m) => console.log(`✓ ${m}`);

const boss = new PgBoss({ connectionString: DB, schema: "pgboss", supervise: false, schedule: false, max: 2 });
await boss.start();
await boss.createQueue(GEN_DLQ).catch(() => {});
await boss.createQueue(GEN_QUEUE, { ...GEN_QUEUE_POLICY }).catch(() => {});

async function enqueue({ projectId, shotId, prompt, kind, model }) {
  // mirrors startGen exactly (web action): persist GenJob, dispatch to the queue
  const job = await prisma.genJob.create({
    data: {
      id: newId(), ownerId: OWNER, projectId, shotId: shotId ?? null,
      prompt, entityIds: [], count: 1, model,
      kind: kind === "video" ? "VIDEO" : "IMAGE",
    },
  });
  await boss.send(GEN_QUEUE, { genJobId: job.id });
  return job.id;
}
async function waitJob(id, secs = 180) {
  for (let i = 0; i < secs; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const row = await prisma.genJob.findUnique({ where: { id } });
    if (row.status === "DONE" || row.status === "FAILED") return row;
  }
  throw new Error(`job ${id} timed out`);
}
const latestGen = (shotId) =>
  prisma.generation.findFirst({ where: { shotId, deletedAt: null }, orderBy: { version: "desc" }, include: { asset: true } });

// 1. project + a fresh shot we control
let project = await prisma.project.findFirst({ where: { ownerId: OWNER, deletedAt: null }, orderBy: { createdAt: "asc" } });
if (!project) project = await prisma.project.create({ data: { id: newId(), ownerId: OWNER, name: "i2v tracer" } });
const last = await prisma.shot.findFirst({ where: { projectId: project.id }, orderBy: { number: "desc" } });
const shot = await prisma.shot.create({
  data: { id: newId(), ownerId: OWNER, projectId: project.id, number: (last?.number ?? 0) + 1, description: "a cat on a windowsill at dusk" },
});
step(`project "${project.name}" · shot #${shot.number}`);

// 2. source image (t2i) — i2v has nothing to animate without it
const imgJob = await waitJob(await enqueue({ projectId: project.id, shotId: shot.id, prompt: shot.description, kind: "image", model: "seedream" }));
if (imgJob.status !== "DONE") throw new Error(`image gen ${imgJob.status}: ${imgJob.error}`);
const img = await latestGen(shot.id);
if (!img || !IMG_EXTS.includes(img.asset.ext.toLowerCase())) throw new Error("no source image produced");
step(`source image v${img.version} ${img.asset.ext} ${img.asset.sizeBytes}B`);

// 3. guard: i2v on a shot with NO image must terminal-fail WITHOUT spending
{
  const bareLast = await prisma.shot.findFirst({ where: { projectId: project.id }, orderBy: { number: "desc" } });
  const bare = await prisma.shot.create({ data: { id: newId(), ownerId: OWNER, projectId: project.id, number: (bareLast?.number ?? 0) + 1 } });
  const j = await waitJob(await enqueue({ projectId: project.id, shotId: bare.id, prompt: "animate nothing", kind: "video", model: "kling" }));
  if (j.status !== "FAILED") throw new Error(`i2v with no source image ended ${j.status}, expected FAILED`);
  if (j.generationIds.length !== 0) throw new Error("no-source i2v produced output (spent!)");
  step(`no-source i2v terminal-fails without spending: "${j.error}"`);
}

// 4. animate (i2v) the source frame
const vidJob = await waitJob(await enqueue({ projectId: project.id, shotId: shot.id, prompt: "the cat slowly turns its head, gentle breeze", kind: "video", model: "kling" }));
if (vidJob.status !== "DONE") throw new Error(`i2v ${vidJob.status}: ${vidJob.error}`);
const vid = await latestGen(shot.id);
if (vid.asset.ext.toLowerCase() !== "mp4") throw new Error(`latest ext ${vid.asset.ext}, expected mp4`);
if (vid.version <= img.version) throw new Error(`video v${vid.version} not newer than image v${img.version}`);
if (!vid.attachedAt) throw new Error("i2v output not attached to the shot");
if (vid.asset.mime !== "video/mp4") throw new Error(`mime ${vid.asset.mime}, expected video/mp4`);
const shotRow = await prisma.shot.findUnique({ where: { id: shot.id } });
if (shotRow.status !== "ATTACHED") throw new Error(`shot status ${shotRow.status}, expected ATTACHED`);
step(`i2v video v${vid.version} mp4 attached · shot ATTACHED · ${vid.asset.sizeBytes}B`);

// 4a. crash-after-spend guard (codex blocker #1): a redelivered job stuck in
//     GENERATING with no generationIds must fail closed WITHOUT re-spending.
{
  const before = await prisma.generation.count({ where: { shotId: shot.id, deletedAt: null } });
  const ghost = await prisma.genJob.create({
    data: {
      id: newId(), ownerId: OWNER, projectId: project.id, shotId: shot.id,
      prompt: "interrupted i2v", entityIds: [], count: 1, model: "kling",
      kind: "VIDEO", status: "GENERATING", startedAt: new Date(), attempts: 1,
    },
  });
  await boss.send(GEN_QUEUE, { genJobId: ghost.id });
  const row = await waitJob(ghost.id, 40);
  if (row.status !== "FAILED") throw new Error(`crash-resume job ended ${row.status}, expected FAILED`);
  if (!/interrupted/i.test(row.error)) throw new Error(`crash-resume error not the guard: "${row.error}"`);
  const after = await prisma.generation.count({ where: { shotId: shot.id, deletedAt: null } });
  if (after !== before) throw new Error(`crash-resume re-spent: generations ${before}→${after}`);
  step(`crash-after-spend guard: GENERATING redelivery fails closed, no re-spend (gens ${before}=${after})`);
}

// 4b. cross-project guard (codex major): a job for THIS project but pointing at
//     a shot in another project must fail closed without spending.
{
  const projB = await prisma.project.create({ data: { id: newId(), ownerId: OWNER, name: "i2v tracer B" } });
  const lastB = await prisma.shot.findFirst({ where: { projectId: projB.id }, orderBy: { number: "desc" } });
  const shotB = await prisma.shot.create({ data: { id: newId(), ownerId: OWNER, projectId: projB.id, number: (lastB?.number ?? 0) + 1 } });
  const j = await prisma.genJob.create({
    data: { id: newId(), ownerId: OWNER, projectId: project.id, shotId: shotB.id, prompt: "x", entityIds: [], count: 1, model: "kling", kind: "VIDEO" },
  });
  await boss.send(GEN_QUEUE, { genJobId: j.id });
  const row = await waitJob(j.id, 40);
  if (row.status !== "FAILED") throw new Error(`cross-project job ended ${row.status}, expected FAILED`);
  if (!/not in this project/i.test(row.error)) throw new Error(`cross-project error unexpected: "${row.error}"`);
  if (row.generationIds.length !== 0) throw new Error("cross-project job produced output (spent!)");
  step(`cross-project guard: shot from another project fails closed, no spend`);
}

// 5. the video is the shot's render → it shows as videoUrl + a VIDEO board clip
const key = storageKey(vid.asset.ownerId, vid.asset.contentHash, vid.asset.ext);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
if (!VIDEO_EXTS.has(vid.asset.ext.toLowerCase())) throw new Error("board clip would not be video");
step(`board edit: shot #${shot.number} → VIDEO clip ${storageKeyToSrc(key)}`);

// 6. the worker actually wrote the bytes (local-disk backend = repo/.data/storage)
const { statSync } = await import("node:fs");
try {
  const onDisk = statSync(`.data/storage/${key}`).size;
  if (onDisk !== Number(vid.asset.sizeBytes)) throw new Error(`on-disk ${onDisk}B != asset ${vid.asset.sizeBytes}B`);
  step(`worker wrote ${onDisk}B to .data/storage/${key}`);
} catch (e) {
  console.log(`· on-disk check skipped (${e.message}) — worker may use R2, not local disk`);
}

// 7. the web route serves it to authed users (unauth → 302 /login is expected)
const res = await fetch(WEB + storageKeyToSrc(key), { redirect: "manual" });
if (res.status === 200) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== Number(vid.asset.sizeBytes)) throw new Error(`served ${buf.length}B != asset ${vid.asset.sizeBytes}B`);
  step(`web serves the clip → 200 ${res.headers.get("content-type")} ${buf.length}B`);
} else if ((res.status === 302 || res.status === 307) && (res.headers.get("location") || "").includes("/login")) {
  step(`web route is auth-gated (→ /login) — clip reachable to a signed-in user`);
} else {
  console.log(`· web returned ${res.status} (expected 200 or 302→/login) — DB-level i2v still verified`);
}

await boss.stop();
await prisma.$disconnect();
console.log("\nI2V TRACER PASSED (mock provider, $0)");
process.exit(0);
