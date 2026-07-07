// PROD quality sampler — captures REAL cowork outputs (full text) on the LIVE site so a
// quality audit can judge them, not just "did it run". Real fal. Writes a JSON of:
//   enhance[] {model,mode,before,after,mentionKept}, draft[] {idea,scenes,shots[]},
//   coach[] {model,mode,hints[]}, media[] {prompt,model,screenshot}.
// Reads-only against prod DB. Run:
//   PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-quality-sampler.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "real cowork enhance/draft/coach + media generations on the LIVE site", prod: "LIVE site + prod Neon DB (reads)" });
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writePngFixture } from "../tools/qa-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const OUT = path.join(os.homedir(), ".gstack/projects/fikirtive/quality");
await mkdir(OUT, { recursive: true });
const SAMPLES = path.join(OUT, "samples.json");
const SRC_IMG = await writePngFixture(OUT, "qa-start-frame.png", "source");

const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const charName = "Mira" + Date.now().toString(36).slice(-4);
const out = { capturedAt: new Date().toISOString(), enhance: [], draft: [], coach: [], media: [], charName };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, storageState: ".prod-session.json" });
const page = await ctx.newPage();
let nshot = 0;
const snap = async (l) => { nshot += 1; const p = path.join(OUT, `${String(nshot).padStart(2, "0")}-${l}.png`); await page.screenshot({ path: p }); return p; };
const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();
async function clearEditor() { await editor.click(); await page.keyboard.press("Meta+a"); await page.keyboard.press("Backspace"); }
async function addMention(name) {
  await page.keyboard.type("@"); await page.keyboard.type(name, { delay: 40 });
  await page.locator('[role="option"]', { hasText: name }).first().waitFor({ timeout: 8000 });
  await page.keyboard.press("Enter");
}
async function doEnhance() {
  const before = (await editor.innerText()).trim();
  await page.getByRole("button", { name: "Enhance prompt" }).click();
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) { await page.waitForTimeout(500); after = (await editor.innerText()).trim(); }
  return { before, after };
}
async function coachHints(label) {
  const pill = page.getByRole("button", { name: /tips? for/ });
  if (!(await pill.count())) return [];
  const expanded = await page.locator('[aria-expanded="true"]', { hasText: /tips? for/ }).count();
  if (!expanded) await pill.first().click().catch(() => {});
  await page.waitForTimeout(400);
  const hints = await page.locator(".al-promptbar, .composer-dock").locator("text=/merge multiple|concurrent motions|natural-language|describe the motion/i").allInnerTexts().catch(() => []);
  return [...new Set(hints.map((h) => h.trim()).filter(Boolean))];
}

try {
  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("not authenticated");
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod Quality Sample");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  const projectId = new URL(page.url()).searchParams.get("p");

  // a character (for @mention / i2i)
  await page.getByRole("button", { name: "Elements", exact: true }).click();
  await page.getByRole("button", { name: "New element", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("tab", { name: "Character", exact: true }).click();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill(charName);
  await page.locator('input[aria-label="Source images"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[role="dialog"] .ref-thumb').first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Save element", exact: true }).click();
  await page.locator(".ref-thumb").first().waitFor({ timeout: 25000 });
  await page.goto(BASE + `/studio?p=${projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gen space", exact: true }).click();

  // ── ENHANCE samples (seedream t2i unless noted) ────────────────────────────
  const photoCases = [
    { id: "decent", before: "a woman reading a book by a rainy window" },
    { id: "tag-soup", before: "woman, rain, window, book, cozy, warm light, moody, cinematic, bokeh" },
    { id: "vague-short", before: "a cat" },
    { id: "hard-constraint", before: "exactly two people shaking hands and absolutely no one else in frame" },
  ];
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  for (const c of photoCases) {
    await clearEditor(); await page.keyboard.type(c.before);
    const { before, after } = await doEnhance();
    const shot = await snap(`enh-${c.id}`);
    out.enhance.push({ id: c.id, model: "seedream", mode: "t2i", before, after, mentionKept: null, screenshot: shot });
  }
  // seedream i2i with @mention — does it keep the chip + condition?
  await clearEditor(); await page.keyboard.type("a portrait of "); await addMention(charName); await page.keyboard.type(" in golden hour");
  { const { before, after } = await doEnhance(); const kept = (await page.locator(".mention-input .mention", { hasText: charName }).count()) > 0; const shot = await snap("enh-i2i-mention"); out.enhance.push({ id: "i2i-mention", model: "seedream", mode: "i2i", before, after, mentionKept: kept, screenshot: shot }); }

  // kling t2v (motion) + ltx t2v
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.locator('select[aria-label="Video model"]').selectOption("kling");
  await clearEditor(); await page.keyboard.type("a vintage car driving down a coastal road at sunset");
  { const { before, after } = await doEnhance(); const shot = await snap("enh-kling-t2v"); out.enhance.push({ id: "kling-t2v", model: "kling", mode: "t2v", before, after, mentionKept: null, screenshot: shot }); out.coach.push({ model: "kling", mode: "t2v", hints: await coachHints("kling-t2v") }); }
  await page.locator('select[aria-label="Video model"]').selectOption("ltx-2");
  await clearEditor(); await page.keyboard.type("two old friends laughing together at a cafe table");
  { const { before, after } = await doEnhance(); const shot = await snap("enh-ltx-t2v"); out.enhance.push({ id: "ltx-t2v", model: "ltx", mode: "t2v", before, after, mentionKept: null, screenshot: shot }); }

  // kling i2v (with a source frame) — should focus on MOTION not the scene
  await page.locator('select[aria-label="Video model"]').selectOption("kling");
  await page.locator(".composer-dock input[type='file']").nth(0).setInputFiles(SRC_IMG);
  await page.locator('img[alt="start frame"]').waitFor({ timeout: 25000 });
  await clearEditor(); await page.keyboard.type("the scene comes to life");
  { const { before, after } = await doEnhance(); const shot = await snap("enh-kling-i2v"); out.enhance.push({ id: "kling-i2v", model: "kling", mode: "i2v", before, after, mentionKept: null, screenshot: shot }); out.coach.push({ model: "kling", mode: "i2v", hints: await coachHints("kling-i2v") }); }
  // remove source for cleanliness
  await page.getByRole("button", { name: "Remove reference", exact: true }).click().catch(() => {});

  // ── DRAFT samples (full shot text from DB) ─────────────────────────────────
  for (const idea of ["a 30-second ad for a sustainable sneaker brand made from ocean plastic", "a moody short film about a lonely lighthouse keeper through one stormy night"]) {
    await page.getByRole("button", { name: "Storyboard", exact: true }).click();
    const before = await prisma.shot.count({ where: { projectId, deletedAt: null } });
    const at = await dbNow();
    await page.locator('input[aria-label="Ask cowork"]').fill(idea);
    await page.getByRole("button", { name: "Draft", exact: true }).click();
    let added = 0;
    for (let i = 0; i < 90 && added < 1; i++) { added = await prisma.shot.count({ where: { projectId, deletedAt: null, createdAt: { gte: at } } }); if (added < 1) await page.waitForTimeout(1000); }
    await page.waitForTimeout(2500); // let the rest of the shots land
    const shots = await prisma.shot.findMany({ where: { projectId, deletedAt: null, createdAt: { gte: at } }, orderBy: { createdAt: "asc" }, select: { description: true } });
    out.draft.push({ idea, count: shots.length, shots: shots.map((s) => s.description) });
    await snap(`draft-${out.draft.length}`);
  }

  // ── MEDIA samples — generate from two enhanced prompts, screenshot ─────────
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  for (const m of [out.enhance.find((e) => e.id === "decent"), out.enhance.find((e) => e.id === "hard-constraint")].filter(Boolean)) {
    await clearEditor(); await page.keyboard.type(m.after.slice(0, 900));
    const at = await dbNow();
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    let done = false;
    for (let i = 0; i < 150 && !done; i++) { const j = (await prisma.genJob.findMany({ where: { projectId, createdAt: { gte: at } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true } }))[0]; if (j?.status === "DONE") done = true; else if (j?.status === "FAILED") break; else await page.waitForTimeout(1000); }
    await page.waitForTimeout(1500);
    const shot = await snap(`media-${m.id}`);
    out.media.push({ id: m.id, model: "seedream", prompt: m.after, screenshot: shot, done });
  }
} catch (e) {
  console.error("sampler error:", e.message);
} finally {
  await browser.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}

await writeFile(SAMPLES, JSON.stringify(out, null, 2));
console.log(`\nsamples → ${SAMPLES}`);
console.log(`enhance: ${out.enhance.length} | draft: ${out.draft.length} (${out.draft.map((d) => d.count).join("+")} shots) | coach: ${out.coach.length} | media: ${out.media.length}`);
out.enhance.forEach((e) => console.log(`  enh[${e.id}] ${e.model}/${e.mode}: ${e.before.length}→${e.after.length}${e.mentionKept === null ? "" : e.mentionKept ? " ·chip✓" : " ·chip✗"}`));
