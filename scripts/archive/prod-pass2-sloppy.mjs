// PROD Pass 2 — persona "sloppy user" on the LIVE site, REAL fal. Focus: the two
// $0 safety nets a careless user trips — promptCoach (offline hints) and Guardian
// (pre-spend block). Reuses .prod-session.json. READS-ONLY against prod Neon (no
// deletes — classifier-safe); unique names + a fresh project keep each run isolated.
// Spend is tiny: Coach + Guardian-block are $0; one clean seedream image (~$0.04).
// Run:  PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-pass2-sloppy.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "~$0.04 — one seedream image on the LIVE site (coach/guardian paths are $0)", prod: "LIVE site + prod Neon DB (reads)" });
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const OUT = path.join(os.homedir(), ".gstack/projects/fikirtive/prod-pass2");
await mkdir(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required (prod assertions)"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");

const sfx = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const noRefName = "SloppyNoRef" + sfx;   // CHARACTER whose ref we delete → 0 refs (Guardian bait)
const refName = "SloppyRef" + sfx;       // CHARACTER that keeps its ref (multi-char partner)
let nshot = 0;
const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;
const liveRefs = async (name) => prisma.referenceImage.count({ where: { deletedAt: null, entity: { ownerId: "founder", name } } });

// NOTE: reads-only — no prod-DB deletes (direct prod DELETEs need separate authorization).
// Unique names + a fresh project id per run keep this isolated; data is cleared in the
// one authorized end-of-campaign sweep.

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
  await page.locator(".ref-thumb").first().waitFor({ timeout: 25000 }); // drawer opens with the uploaded ref
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
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod Pass 2 — sloppy");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  projectId = new URL(page.url()).searchParams.get("p");
  if (!projectId) fail("no projectId after create");
  if (!(await prisma.project.findFirst({ where: { id: projectId, createdAt: { gte: createClick } }, select: { id: true } }))) fail("no Project row created this run (stale project?)");
  await snap("project");
  step(`fresh project ${projectId} (created this run)`);

  // two characters via UI; delete one's ref → a 0-ref CHARACTER (the Guardian bait)
  await createCharacterViaUI(refName);
  await snap("ref-char-created");
  await createCharacterViaUI(noRefName);
  await page.getByRole("button", { name: "Remove reference image" }).first().click();
  for (let i = 0; i < 20 && (await liveRefs(noRefName)) > 0; i++) await page.waitForTimeout(500);
  if ((await liveRefs(noRefName)) !== 0) fail(`@${noRefName} still has refs after UI delete`);
  if ((await liveRefs(refName)) < 1) fail(`@${refName} lost its ref`);
  await snap("noref-char-0refs");
  step(`@${refName} (1 ref) + @${noRefName} (ref DELETED → 0 refs), DB-confirmed`);

  await page.goto(BASE + "/admin/directives", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Seed research defaults" }).click();
  await page.getByText(/Inserted|Already seeded/).waitFor({ timeout: 20000 });
  if ((await prisma.modelDirective.count({ where: { ownerId: "founder" } })) < 6) fail("directives not seeded on prod");
  // bind the Coach assertions to the ACTUAL rule that produces each hint, not just the
  // displayed text (which a pitfalls edit could fake): the tag-soup hint must come from
  // seedream/t2i.noTagCommas and the multi-char hint from ltx/t2v.castSeverity.
  const sdRule = (await prisma.modelDirective.findFirst({ where: { ownerId: "founder", family: "seedream", mode: "t2i" }, select: { rules: true } }))?.rules;
  const ltxRule = (await prisma.modelDirective.findFirst({ where: { ownerId: "founder", family: "ltx", mode: "t2v" }, select: { rules: true } }))?.rules;
  if (sdRule?.noTagCommas !== true) fail(`seedream/t2i rule noTagCommas != true (got ${JSON.stringify(sdRule)}) — tag-soup hint would be from a different rule`);
  if (ltxRule?.castSeverity !== "warn") fail(`ltx/t2v rule castSeverity != "warn" (got ${JSON.stringify(ltxRule)}) — multi-char hint would be from a different rule`);
  await snap("admin-seeded");
  step("knowledge base seeded (DB-confirmed ≥6; seedream.noTagCommas + ltx.castSeverity bound to Coach hints)");

  await page.goto(BASE + `/studio?p=${projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gen space", exact: true }).click();

  // ── COACH 1: tag-soup in Photo (Seedream t2i, noTagCommas) — $0, no @mention ──
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await clearEditor();
  await page.keyboard.type("neon city, rain, night, cyberpunk, glowing signs, wet streets");
  const soupPill = page.getByRole("button", { name: /tips? for Seedream/ });
  await soupPill.waitFor({ timeout: 8000 });
  if (!(await page.getByText(/natural-language sentences/i).count())) await soupPill.click();
  await page.getByText(/natural-language sentences over comma-separated tags/i).first().waitFor({ timeout: 6000 });
  await snap("coach-tagsoup");
  step("COACH: tag-soup prompt → Seedream 'natural-language not tags' warning ($0)");

  // ── COACH 2: LTX + 2 characters (ltx t2v, castSeverity warn) — $0, no Generate ──
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.locator('select[aria-label="Video model"]').selectOption("ltx-2");
  await clearEditor();
  await addMention(noRefName); await page.keyboard.type(" and "); await addMention(refName);
  const ltxPill = page.getByRole("button", { name: /tips? for LTX/ });
  await ltxPill.waitFor({ timeout: 8000 });
  if (!(await page.getByText(/merge multiple characters/i).count())) await ltxPill.click();
  await page.getByText(/merge multiple characters — you have 2/i).first().waitFor({ timeout: 6000 });
  await snap("coach-multichar");
  step("COACH: LTX + 2 chars → 'can merge multiple characters — you have 2' warning ($0)");

  // ── GUARDIAN: a 0-ref CHARACTER must BLOCK before any spend ($0, NO job) ──
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await page.waitForTimeout(250);
  await clearEditor();
  await page.keyboard.type("a portrait of "); await addMention(noRefName);
  const blockClick = await dbNow();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.getByText(/no reference image/i).first().waitFor({ timeout: 8000 });
  // money-safety: the block must create ZERO jobs (no spend) after the click
  const blockedJobs = await prisma.genJob.count({ where: { projectId, createdAt: { gte: blockClick } } });
  if (blockedJobs !== 0) fail(`Guardian let ${blockedJobs} job(s) through on a 0-ref char — SPENT money it shouldn't`);
  await snap("guardian-block");
  await page.getByRole("button", { name: /Add a reference in Elements/ }).click();
  await page.getByRole("button", { name: "New element", exact: true }).waitFor({ timeout: 8000 });
  await snap("guardian-cta-elements");
  step("GUARDIAN: 0-ref char BLOCKED ($0, 0 jobs); 'Add a reference' CTA reached Elements");

  // ── GUARDIAN pass: the sloppy user drops the @mention → a clean prompt generates ──
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await page.waitForTimeout(250);
  await clearEditor();
  const cleanPrompt = "a calm wide shot of a quiet street at dawn, soft light";
  await page.keyboard.type(cleanPrompt);
  const passClick = await dbNow();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  if (await page.getByText(/no reference image/i).count()) fail("Guardian wrongly blocked a clean request");
  let job = null;
  for (let i = 0; i < 150; i++) {
    const js = await prisma.genJob.findMany({ where: { projectId, createdAt: { gte: passClick } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true, generationIds: true, prompt: true, model: true, kind: true } });
    if (js.length > 1) fail(`one Generate click created ${js.length} jobs — DOUBLE-SPEND on prod`);
    if (js.length === 1) { const l = js[0]; if (l.status === "FAILED") fail(`clean gen FAILED: ${l.error?.slice(0, 140)}`); if (l.status === "DONE") { job = l; break; } }
    await page.waitForTimeout(1000);
  }
  if (!job) fail("the clean Generate did not create a job that reached DONE");
  if (job.prompt !== cleanPrompt) fail(`job.prompt mismatch — bound to the wrong job`);
  if (job.model !== "seedream" || job.kind !== "IMAGE") fail(`job model/kind mismatch: ${job.model}/${job.kind}`);
  const gens = await prisma.generation.findMany({ where: { id: { in: job.generationIds }, deletedAt: null, projectId }, select: { asset: { select: { contentHash: true } } } });
  if (gens.length < 1) fail("the clean job produced no Generation in this project");
  const hashes = gens.map((g) => g.asset?.contentHash?.toLowerCase()).filter(Boolean);
  const resImg = page.locator('img[src*="/files/"]').last();
  await resImg.waitFor({ timeout: 25000 });
  let imgLoaded = false;
  for (let i = 0; i < 30 && !imgLoaded; i++) { imgLoaded = await resImg.evaluate((im) => im.complete && im.naturalWidth > 0).catch(() => false); if (!imgLoaded) await page.waitForTimeout(500); }
  if (!imgLoaded) fail("clean gen image present but never decoded");
  const shownSrc = (await resImg.getAttribute("src") || "").toLowerCase();
  if (!hashes.some((h) => shownSrc.includes(h))) fail("on-screen image does not match this job's generation contentHash");
  await snap("guardian-pass-real-gen");
  step(`GUARDIAN: clean request PASSED → 1 real image on prod (job ${job.id.slice(0, 8)} DONE, on-screen == this job's gen)`);
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
console.log("PROD PASS 2 (sloppy user) PASSED — Coach(tag-soup + multi-char) · Guardian(block $0 + CTA + clean pass → real image), request-correlated");
process.exit(0);
