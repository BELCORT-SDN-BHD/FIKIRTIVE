// PROD Pass 3 — persona "brute / money-safety stress" on the LIVE site, REAL fal.
// The centerpiece is the DOUBLE-CLICK test: fire two synchronous clicks on Generate in
// the SAME JS frame (worst case for the client `busy` guard, since GenSpace intentionally
// passes no idempotencyKey on batches — see commit a324825) and assert prod creates
// EXACTLY ONE paid job, not two. Plus: a near-max-length prompt still generates, and
// rapid model switching never strands stale Coach state. Reads-only against prod Neon.
// Run:  PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-pass3-brute.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "real fal generations on the LIVE site (double-click money-safety stress)", prod: "LIVE site + prod Neon DB (reads)" });
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const OUT = path.join(os.homedir(), ".gstack/projects/artlio/prod-pass3");
await mkdir(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required (prod assertions)"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");

const sfx = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const charA = "BruteA" + sfx, charB = "BruteB" + sfx;
let nshot = 0;
const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;
const jobsSince = (projectId, ts) => prisma.genJob.count({ where: { projectId, createdAt: { gte: ts } } });

// NOTE: reads-only — no prod-DB deletes. Unique names + a fresh project per run isolate it.

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, storageState: ".prod-session.json" });
const page = await ctx.newPage();
const snap = async (label) => { nshot += 1; await page.screenshot({ path: path.join(OUT, `${String(nshot).padStart(2, "0")}-${label}.png`) }); };
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();
async function clearEditor() { await editor.click(); await page.keyboard.press("Meta+a"); await page.keyboard.press("Backspace"); }
async function addMention(name) {
  await page.keyboard.type("@"); await page.keyboard.type(name, { delay: 40 });
  await page.locator('[role="option"]', { hasText: name }).first().waitFor({ timeout: 8000 });
  await page.keyboard.press("Enter");
}
async function createCharacterViaUI(name) {
  await page.getByRole("button", { name: "Elements", exact: true }).click();
  await page.getByRole("button", { name: "New element", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("tab", { name: "Character", exact: true }).click();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill(name);
  await page.locator('input[aria-label="Source images"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[role="dialog"] .ref-thumb').first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Save element", exact: true }).click();
  await page.locator(".ref-thumb").first().waitFor({ timeout: 25000 });
}
async function waitJobDone(projectId, ts) {
  for (let i = 0; i < 150; i++) {
    const j = (await prisma.genJob.findMany({ where: { projectId, createdAt: { gte: ts } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, error: true } }))[0];
    if (j) { if (j.status === "FAILED") fail(`gen FAILED: ${j.error?.slice(0, 140)}`); if (j.status === "DONE") return j; }
    await page.waitForTimeout(1000);
  }
  fail("job never reached DONE");
}

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
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod Pass 3 — brute");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  projectId = new URL(page.url()).searchParams.get("p");
  if (!projectId) fail("no projectId after create");
  if (!(await prisma.project.findFirst({ where: { id: projectId, createdAt: { gte: createClick } }, select: { id: true } }))) fail("no Project row created this run");
  await snap("project");
  step(`fresh project ${projectId} (created this run)`);

  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();

  // ── CORE: double-click Generate → must create EXACTLY ONE paid job ──────────
  await clearEditor();
  await page.keyboard.type("a quiet harbor at first light, calm water, soft mist");
  const genBtn = page.getByRole("button", { name: "Generate", exact: true });
  const dcClick = await dbNow();
  // two clicks in ONE synchronous frame — the harshest test of the client busy-guard
  await genBtn.evaluate((b) => { b.click(); b.click(); });
  // settle: fail fast on a 2nd job; accept only after the count is a stable single job
  let ones = 0, twoPlus = 0;
  for (let i = 0; i < 30 && ones < 6; i++) {
    const c = await jobsSince(projectId, dcClick);
    if (c >= 2) { twoPlus = c; break; }
    ones = c === 1 ? ones + 1 : 0;
    await page.waitForTimeout(1000);
  }
  if (twoPlus >= 2) { await snap("double-click-DOUBLE-SPEND"); fail(`DOUBLE-SPEND: one double-click created ${twoPlus} paid jobs on prod`); }
  if (ones < 6) fail("double-click produced no stable single job within timeout");
  const dcJob = await waitJobDone(projectId, dcClick);
  if ((await jobsSince(projectId, dcClick)) !== 1) fail("a 2nd job appeared after settle — double-spend");
  await snap("double-click-one-job");
  step(`DOUBLE-CLICK money-safety: two synchronous clicks → EXACTLY 1 paid job (${dcJob.id.slice(0, 8)} DONE), no double-spend`);

  // ── near-max-length prompt (< MAX_GEN_PROMPT 2000) still generates ──────────
  await clearEditor();
  const bigPrompt = ("a sweeping cinematic establishing shot of a rain-slicked harbor town at dawn, " +
    "weathered fishing boats, gulls, soft volumetric light through low mist, ").repeat(13).slice(0, 1900);
  await page.keyboard.insertText(bigPrompt);
  const bigClick = await dbNow();
  await genBtn.click();
  const bigJob = await waitJobDone(projectId, bigClick);
  if ((await jobsSince(projectId, bigClick)) !== 1) fail("big-prompt gen did not create exactly one job");
  const bigRow = await prisma.genJob.findFirst({ where: { id: bigJob.id }, select: { prompt: true } });
  if ((bigRow?.prompt?.length ?? 0) < 1500) fail(`big prompt truncated below 1500 chars (got ${bigRow?.prompt?.length})`);
  await snap("big-prompt-gen");
  step(`BIG PROMPT: ${bigRow.prompt.length}-char prompt generated cleanly (1 job, DONE)`);

  // ── rapid model switching must not strand stale Coach state ($0) ───────────
  await createCharacterViaUI(charA); await snap("charA");
  await createCharacterViaUI(charB); await snap("charB");
  await page.goto(BASE + `/studio?p=${projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await clearEditor();
  await addMention(charA); await page.keyboard.type(" and "); await addMention(charB);
  const sel = page.locator('select[aria-label="Video model"]');
  // thrash the model select, end on LTX → multi-char warn must be CURRENT (not stale Kling)
  await sel.selectOption("kling"); await sel.selectOption("ltx-2"); await sel.selectOption("kling"); await sel.selectOption("ltx-2");
  const ltxPill = page.getByRole("button", { name: /tips? for LTX/ });
  await ltxPill.waitFor({ timeout: 8000 });
  if (!(await page.getByText(/merge multiple characters/i).count())) await ltxPill.click();
  await page.getByText(/merge multiple characters — you have 2/i).first().waitFor({ timeout: 6000 });
  // switch back to Kling → the LTX multi-char hint must be GONE, motion hint present
  await sel.selectOption("kling");
  const klingPill = page.getByRole("button", { name: /tips? for Kling/ });
  await klingPill.waitFor({ timeout: 8000 });
  if (!(await page.getByText(/concurrent motions/i).count())) await klingPill.click();
  await page.getByText(/concurrent motions/i).first().waitFor({ timeout: 6000 });
  if (await page.getByText(/merge multiple characters/i).count()) fail("stale LTX multi-char hint still showing under Kling — Coach state didn't update");
  await snap("model-switch-coach");
  step("MODEL-SWITCH: thrashed Kling↔LTX → Coach hints always match the CURRENT model (no stale state)");
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  if (projectId) {
    const inflight = await prisma.genJob.count({ where: { projectId, status: { in: ["QUEUED", "GENERATING"] } } }).catch(() => 0);
    if (inflight > 0) console.log(`⚠ ${inflight} job(s) still QUEUED/GENERATING on prod for ${projectId} — may still be charged`);
  }
  await prisma.$disconnect().catch(() => {});
}

const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|preload|\/files\/.*404|Failed to load resource|favicon/.test(e));
console.log(`\nscreenshots → ${OUT}`);
if (fatal.length) { console.log("PAGE ERRORS (failing):"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
if (!passed) process.exit(1);
console.log("PROD PASS 3 (brute) PASSED — double-click=1 job (no double-spend) · big prompt · model-switch Coach integrity, request-correlated");
process.exit(0);
