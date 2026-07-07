// PROD Pass 1 — persona "careful creator" (happy path), REAL fal on the LIVE site.
// Reuses the saved session (.prod-session.json). Every paid result is REQUEST-CORRELATED
// against prod Neon (new DONE job + its Generation; enhance audit created AFTER the click;
// shots count delta) — no "any recent / any image" false-pass. Cleanup is SCOPED to the
// exact test project id + the uniquely-named test character (no broad prod deletes).
// Run:  PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-pass1-careful.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "real fal generations on the LIVE site (happy-path persona pass)", prod: "LIVE site + prod Neon DB (scoped test writes + scoped cleanup)" });
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const OUT = path.join(os.homedir(), ".gstack/projects/fikirtive/prod-pass1");
await mkdir(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required (prod assertions + scoped cleanup)"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");

const charName = "PassOne" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
let nshot = 0;
const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
// Lower-bound timestamps come from Neon's own clock, not this machine's — otherwise
// local clock skew vs the DB could widen the "after the click" window (false-pass on an
// unrelated row) or invert it (false-fail). Every correlated read uses a dbNow() fence.
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;

// NOTE: prod-DB cleanup is intentionally NOT done here — direct prod DELETEs need
// separate explicit authorization. Each run uses a UNIQUE project id + char name, so
// the new project is always fresh (assertions below confirm). Test data accumulates
// on prod and is cleaned in a single authorized sweep at the end of the campaign.

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
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod Pass 1 — careful");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  projectId = new URL(page.url()).searchParams.get("p");
  if (!projectId) fail("no projectId after create");
  // bind to a REAL Project row this click created (name + createdAt >= click), not just
  // the URL param — a route bug landing on a stale empty project would otherwise pass.
  const proj = await prisma.project.findFirst({ where: { id: projectId, createdAt: { gte: createClick } }, select: { name: true } });
  if (!proj) fail("no Project row created after the create click (landed on a pre-existing project?)");
  if ((await prisma.shot.count({ where: { projectId } })) !== 0 || (await prisma.genJob.count({ where: { projectId } })) !== 0) fail("project not fresh (pre-existing shots/jobs)");
  await snap("project");
  step(`fresh project ${projectId} (created this run, 0 shots, 0 jobs)`);

  // careful: a CHARACTER WITH a reference (Upload door)
  await page.getByRole("button", { name: "Elements", exact: true }).click();
  await page.getByRole("button", { name: "New element", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("tab", { name: "Character", exact: true }).click();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill(charName);
  await page.locator('input[aria-label="Source images"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[role="dialog"] .ref-thumb').first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Save element", exact: true }).click();
  await page.locator(".ref-thumb").first().waitFor({ timeout: 25000 });
  for (let i = 0; i < 20 && (await prisma.referenceImage.count({ where: { deletedAt: null, entity: { name: charName } } })) < 1; i++) await page.waitForTimeout(500);
  if ((await prisma.referenceImage.count({ where: { deletedAt: null, entity: { name: charName } } })) < 1) fail("character ref not persisted");
  await snap("character-with-ref");
  step(`created @${charName} WITH a reference (DB-confirmed)`);

  await page.goto(BASE + "/admin/directives", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Seed research defaults" }).click();
  await page.getByText(/Inserted|Already seeded/).waitFor({ timeout: 20000 });
  if ((await prisma.modelDirective.count({ where: { ownerId: "founder" } })) < 6) fail("directives not seeded on prod");
  await snap("admin-seeded");
  step("seeded the per-model knowledge base (DB-confirmed ≥6)");

  await page.goto(BASE + `/studio?p=${projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.getByRole("button", { name: /tips? for Kling/ }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /tips? for Kling/ }).click();
  await page.getByText(/concurrent motions/i).first().waitFor({ timeout: 6000 });
  await snap("coach");
  step("Coach hint shows for Kling");

  // real ✨ Enhance — request-correlated proof (audit created AFTER the click, via=fal:llm)
  await clearEditor();
  await page.keyboard.type("dawn light on "); await addMention(charName); await page.keyboard.type(" by the window");
  const before = (await editor.innerText()).trim();
  const enhClick = await dbNow();
  await page.getByRole("button", { name: "Enhance prompt" }).click();
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) { await page.waitForTimeout(500); after = (await editor.innerText()).trim(); }
  if (after === before) fail("Enhance did not change the prompt");
  await page.locator(".mention-input .mention", { hasText: charName }).first().waitFor({ timeout: 6000 });
  // exactly ONE new enhance audit, and it must be THIS click's: payload.chars is the
  // server's output length, so chars === the rewritten text length in the editor binds
  // the audit to the prompt now on screen (not a concurrent/stale enhance for the project).
  const enhAudits = await prisma.actionEvent.findMany({ where: { projectId, type: "cowork.enhance", createdAt: { gte: enhClick } }, orderBy: { createdAt: "desc" }, select: { payload: true } });
  if (enhAudits.length !== 1) fail(`expected exactly 1 cowork.enhance audit after the click, found ${enhAudits.length}`);
  const a = enhAudits[0];
  if (a.payload?.via !== "fal:llm") fail(`cowork.enhance via="${a.payload?.via}" — NOT real fal on prod`);
  // payload.chars is the server's raw output length; the editor's innerText().trim()
  // normalizes trailing whitespace and the @mention chip, so they can differ by a couple
  // of chars for the SAME rewrite. A wrong/stale audit would differ by hundreds (input was
  // ~48 chars), so a tight tolerance still binds the audit to what's on screen.
  if (Math.abs((a.payload?.chars ?? -999) - after.length) > 5) fail(`enhance audit chars=${a.payload?.chars} not within 5 of on-screen length ${after.length} — audit not bound to THIS rewrite`);
  await snap("enhance-real");
  step(`ENHANCE on prod is REAL fal (via=fal:llm, audit.chars==on-screen ${after.length}, chip kept); ${before.length}→${after.length}`);

  // real image gen — bind to the EXACT job this click created (prompt+model+kind),
  // assert no double-spend (exactly one new job), and bind the on-screen image to that
  // job's Generation asset by contentHash (the /files/ URL embeds the hash).
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await page.waitForTimeout(250);
  await clearEditor();
  const imgPrompt = "a calm wide shot of a quiet street at dawn, soft light";
  await page.keyboard.type(imgPrompt);
  const genClick = await dbNow();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  let job = null;
  for (let i = 0; i < 150; i++) {
    const js = await prisma.genJob.findMany({ where: { projectId, createdAt: { gte: genClick } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true, generationIds: true, prompt: true, model: true, kind: true } });
    if (js.length > 1) fail(`one Generate click created ${js.length} jobs — DOUBLE-SPEND on prod`); // money-safety
    if (js.length === 1) { const l = js[0]; if (l.status === "FAILED") fail(`gen FAILED: ${l.error?.slice(0, 140)}`); if (l.status === "DONE") { job = l; break; } }
    await page.waitForTimeout(1000);
  }
  if (!job) fail("the Generate click did not create a job that reached DONE");
  if (job.prompt !== imgPrompt) fail(`job.prompt="${job.prompt?.slice(0, 40)}" != the prompt typed — bound to the wrong job`);
  if (job.model !== "seedream" || job.kind !== "IMAGE") fail(`job model/kind mismatch: ${job.model}/${job.kind}`);
  const gens = await prisma.generation.findMany({ where: { id: { in: job.generationIds }, deletedAt: null, projectId }, select: { asset: { select: { contentHash: true } } } });
  if (gens.length < 1) fail("the gen job produced no Generation in this project");
  const hashes = gens.map((g) => g.asset?.contentHash?.toLowerCase()).filter(Boolean);
  const resImg = page.locator('img[src*="/files/"]').last();
  await resImg.waitFor({ timeout: 25000 });
  // the <img> renders as soon as the job is DONE, but the browser fetches the R2 bytes
  // lazily — poll naturalWidth so a slow decode isn't a false negative, while a genuinely
  // broken image (never decodes in 15s) still fails the pass.
  let imgLoaded = false;
  for (let i = 0; i < 30 && !imgLoaded; i++) { imgLoaded = await resImg.evaluate((im) => im.complete && im.naturalWidth > 0).catch(() => false); if (!imgLoaded) await page.waitForTimeout(500); }
  if (!imgLoaded) fail("generated image present but never decoded (naturalWidth stayed 0 for 15s)");
  // the on-screen image must BE this job's output, not some other /files/ asset
  const shownSrc = (await resImg.getAttribute("src") || "").toLowerCase();
  if (!hashes.some((h) => shownSrc.includes(h))) fail(`on-screen image src does not match this job's generation contentHash — wrong image`);
  await snap("generated-image");
  step(`generated a REAL image on prod (job ${job.id.slice(0, 8)} DONE, on-screen image == this job's generation)`);

  // real draft — assert a real shots DELTA (not absolute) + a cowork.draft audit this click wrote
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  const shotsBefore = await prisma.shot.count({ where: { projectId, deletedAt: null } });
  await page.locator('input[aria-label="Ask cowork"]').fill("a warm 3-shot ad for a neighbourhood bakery at sunrise");
  const draftClick = await dbNow();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  let shots = shotsBefore;
  for (let i = 0; i < 60 && shots - shotsBefore < 3; i++) { shots = await prisma.shot.count({ where: { projectId, deletedAt: null } }); if (shots - shotsBefore < 3) await page.waitForTimeout(1000); }
  if (shots - shotsBefore < 3) fail(`draft added only ${shots - shotsBefore} shots (before ${shotsBefore}, now ${shots})`);
  const draftAudit = await prisma.actionEvent.findFirst({ where: { projectId, type: "cowork.draft", createdAt: { gte: draftClick } }, orderBy: { createdAt: "desc" }, select: { payload: true } });
  if (!draftAudit) fail("no cowork.draft audit after the Draft click");
  if (draftAudit.payload?.via !== "fal:llm") fail(`cowork.draft via="${draftAudit.payload?.via}" — NOT real fal`);
  await snap("draft");
  step(`drafted a storyboard → +${shots - shotsBefore} shots, cowork.draft via=fal:llm (real)`);
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  // reads-only: no prod-DB deletes here (see NOTE at top). Report any paid jobs still
  // in flight so a mid-run failure doesn't silently leave money burning unnoticed.
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
console.log("PROD PASS 1 (careful creator) PASSED — real fal, request-correlated (no prod deletes; test data persists for end-of-campaign sweep)");
process.exit(0);
