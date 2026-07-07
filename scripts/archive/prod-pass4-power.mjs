// PROD Pass 4 — persona "power user" on the LIVE site, REAL fal. Exercises the heavier
// paths: a bigger multi-scene cowork draft, and a real image-to-video with BOTH a start
// frame and an end frame (i2v-tail on Kling). Source/tail are real repo PNGs (a 1x1 pixel
// can be rejected by the video model). Reads-only against prod Neon; request-correlated.
// Spend: a cowork draft (cents) + one Kling i2v-tail clip (~$0.35). Run:
//   PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-pass4-power.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "~$0.35+ — a cowork draft (cents) + one Kling i2v-tail clip on the LIVE site", prod: "LIVE site + prod Neon DB (reads)" });
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { writePngFixture } from "../tools/qa-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const OUT = path.join(os.homedir(), ".gstack/projects/fikirtive/prod-pass4");
await mkdir(OUT, { recursive: true });
const SRC_IMG = await writePngFixture(OUT, "qa-start-frame.png", "source");
const TAIL_IMG = await writePngFixture(OUT, "qa-end-frame.png", "tail");
// sha256 of the bytes IS the Asset.contentHash (storage/src/index.ts) — lets us bind the
// uploaded source/tail generations (and the rendered video) to THESE exact files.
const sha = async (p) => createHash("sha256").update(await readFile(p)).digest("hex");
const SRC_HASH = await sha(SRC_IMG);
const TAIL_HASH = await sha(TAIL_IMG);

const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required (prod assertions)"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");

let nshot = 0;
const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;

// NOTE: reads-only — no prod-DB deletes. Fresh project per run isolates it.

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, storageState: ".prod-session.json" });
const page = await ctx.newPage();
const snap = async (label) => { nshot += 1; await page.screenshot({ path: path.join(OUT, `${String(nshot).padStart(2, "0")}-${label}.png`) }); };
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

let passed = false, projectId = null;
try {
  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/login")) fail("not authenticated — re-run prod-login with a fresh link");
  await snap("studio");
  step("authenticated on prod (reused session)");

  const createClick = await dbNow();
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod Pass 4 — power");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  projectId = new URL(page.url()).searchParams.get("p");
  if (!projectId) fail("no projectId after create");
  if (!(await prisma.project.findFirst({ where: { id: projectId, createdAt: { gte: createClick } }, select: { id: true } }))) fail("no Project row created this run");
  await snap("project");
  step(`fresh project ${projectId} (created this run)`);

  // ── BIG DRAFT: a multi-scene film → more shots than a trivial draft ─────────
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  const shotsBefore = await prisma.shot.count({ where: { projectId, deletedAt: null } });
  await page.locator('input[aria-label="Ask cowork"]').fill("a detailed brand film for an artisan coffee roastery, three distinct scenes — sourcing beans at the farm, roasting in the workshop, the perfect pour in a cafe — with multiple shots per scene");
  const draftClick = await dbNow();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  let added = 0;
  for (let i = 0; i < 90 && added < 4; i++) { added = (await prisma.shot.count({ where: { projectId, deletedAt: null, createdAt: { gte: draftClick } } })); if (added < 4) await page.waitForTimeout(1000); }
  if (added < 4) fail(`big draft ADDED only ${added} shots after the click (expected a richer multi-scene draft)`);
  const draftAudit = await prisma.actionEvent.findFirst({ where: { projectId, type: "cowork.draft", createdAt: { gte: draftClick } }, orderBy: { createdAt: "desc" }, select: { payload: true } });
  if (!draftAudit || draftAudit.payload?.via !== "fal:llm") fail(`draft audit missing/not fal (via=${draftAudit?.payload?.via})`);
  if ((draftAudit.payload?.shots ?? 0) !== added) fail(`draft audit shots=${draftAudit.payload?.shots} != ${added} shots actually added this click`);
  await snap("big-draft");
  step(`BIG DRAFT: cowork ADDED ${added} shots across ${draftAudit.payload?.scenes} scenes (via=fal:llm, before=${shotsBefore})`);

  // ── i2v-tail: real start+end frame video on Kling ──────────────────────────
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.locator('select[aria-label="Video model"]').selectOption("kling");
  const fileInputs = page.locator(".composer-dock input[type='file']");
  // resolve the UPLOAD Generation created from THIS file (matched by its sha256=contentHash)
  const uploadedGenId = async (hash) => {
    for (let i = 0; i < 30; i++) {
      const g = await prisma.generation.findFirst({ where: { projectId, source: "UPLOAD", deletedAt: null, asset: { contentHash: hash } }, select: { id: true } });
      if (g) return g.id;
      await page.waitForTimeout(500);
    }
    return null;
  };
  // start frame (source) → switches to image-to-video
  await fileInputs.nth(0).setInputFiles(SRC_IMG);
  await page.locator('img[alt="start frame"]').waitFor({ timeout: 25000 });
  const srcGenId = await uploadedGenId(SRC_HASH);
  if (!srcGenId) fail("uploaded start frame did not become an in-project UPLOAD generation (contentHash match)");
  await snap("i2v-source");
  // i2v Coach hint (Kling i2v rules: i2vMotionNotScene)
  const klingPill = page.getByRole("button", { name: /tips? for Kling/ });
  await klingPill.waitFor({ timeout: 8000 });
  if (!(await page.getByText(/describe the motion and camera/i).count())) await klingPill.click();
  await page.getByText(/describe the motion and camera, not the scene/i).first().waitFor({ timeout: 6000 });
  // end frame (tail)
  await fileInputs.nth(1).setInputFiles(TAIL_IMG);
  await page.locator('img[alt="last frame"]').waitFor({ timeout: 25000 });
  await page.getByText(/start → end frame/i).first().waitFor({ timeout: 6000 });
  const tailGenId = await uploadedGenId(TAIL_HASH);
  if (!tailGenId) fail("uploaded end frame did not become an in-project UPLOAD generation (contentHash match)");
  await snap("i2v-tail-set");
  step("i2v-tail: start + end frame uploaded (Kling), both bound to the exact files by contentHash, Coach shows the i2v motion hint");

  const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();
  await editor.click();
  await page.keyboard.type("a slow gentle push-in, the morning light warms across the frame");
  const genClick = await dbNow();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  // bind to the EXACTLY ONE video job this click created
  let job = null;
  for (let i = 0; i < 360; i++) {
    const js = await prisma.genJob.findMany({ where: { projectId, createdAt: { gte: genClick } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true, spent: true, kind: true, model: true, sourceGenerationId: true, tailGenerationId: true, generationIds: true } });
    if (js.length > 1) fail(`one Generate created ${js.length} jobs — double-spend`);
    if (js.length === 1) { const l = js[0]; if (l.status === "FAILED") fail(`i2v-tail video FAILED (spent=${l.spent}): ${l.error?.slice(0, 160)}`); if (l.status === "DONE") { job = l; break; } }
    await page.waitForTimeout(1000);
  }
  if (!job) fail("the i2v-tail Generate did not reach DONE within 6min");
  if (job.kind !== "VIDEO") fail(`job.kind=${job.kind} (expected VIDEO)`);
  if (job.model !== "kling") fail(`job.model=${job.model} (expected kling)`);
  // bind source/tail to the EXACT two files uploaded this run (not just "any in-project gen")
  if (job.sourceGenerationId !== srcGenId) fail(`job.sourceGenerationId=${job.sourceGenerationId} != this run's start frame ${srcGenId}`);
  if (job.tailGenerationId !== tailGenId) fail(`job.tailGenerationId=${job.tailGenerationId} != this run's end frame ${tailGenId}`);
  // the on-screen result must be THIS job's rendered video (bind by the output asset hash)
  const outGen = await prisma.generation.findFirst({ where: { id: { in: job.generationIds }, deletedAt: null, projectId }, select: { asset: { select: { contentHash: true } } } });
  if (!outGen?.asset?.contentHash) fail("the i2v-tail job produced no output generation");
  const outHash = outGen.asset.contentHash.toLowerCase();
  const vid = page.locator(`video[src*="${outHash}"]`).first();
  await vid.waitFor({ timeout: 30000 });
  let vidOk = false;
  for (let i = 0; i < 30 && !vidOk; i++) { vidOk = await vid.evaluate((v) => v.readyState >= 1 || v.videoWidth > 0).catch(() => false); if (!vidOk) await page.waitForTimeout(500); }
  if (!vidOk) fail("the i2v-tail output video is on screen but never loaded metadata");
  await snap("i2v-tail-video");
  step(`i2v-tail: real Kling video on prod (job ${job.id.slice(0, 8)} DONE, source+tail bound to this run's uploads, on-screen video == job output)`);
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  if (projectId) {
    const inflight = await prisma.genJob.findMany({ where: { projectId, status: { in: ["QUEUED", "GENERATING"] } }, select: { id: true, status: true, spent: true } }).catch(() => []);
    if (inflight.length > 0) console.log(`⚠ ${inflight.length} job(s) still in flight on prod for ${projectId} — may be charged:`, inflight.map((j) => `${j.id.slice(0, 8)}:${j.status}:spent=${j.spent}`).join(", "));
  }
  await prisma.$disconnect().catch(() => {});
}

const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|preload|\/files\/.*404|Failed to load resource|favicon/.test(e));
console.log(`\nscreenshots → ${OUT}`);
if (fatal.length) { console.log("PAGE ERRORS (failing):"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
if (!passed) process.exit(1);
console.log("PROD PASS 4 (power user) PASSED — big multi-scene draft · real i2v-tail Kling video (start+end frame, request-correlated)");
process.exit(0);
