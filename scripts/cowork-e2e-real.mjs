// Cowork 100%-real-user E2E — REAL fal keys (COWORK_PROVIDER=fal + GENERATION_PROVIDER=fal),
// NO mock. Every action is driven through the actual UI a human uses, including:
//   - creating the 0-ref CHARACTER fully via UI: Upload a source image (creates a
//     reference) → then DELETE that reference in the entity drawer → 0 refs. (This is
//     the only human path to a 0-ref character — the create dialog forces a reference.)
//   - real ✨ Enhance (real Claude rewrite — assert the text actually CHANGED + the
//     @mention chip survived)
//   - real generation on the clean Guardian pass — assert the GenJob reaches DONE and a
//     Generation row is produced (worker → real fal → stored)
//   - real cowork draft (real Claude storyboard)
// A screenshot is saved after every step. Real spend is kept minimal: 1 Enhance + 1
// draft (a few cents each) + 1 seedream image (~$0.04); the upload + Guardian block are $0.
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../packages/db/dist/src/index.js");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = path.join(os.homedir(), ".gstack/projects/artlio/cowork-e2e-real");
await mkdir(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const sfx = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); // unique per run (avoid name collision)
const charName = "MaraReal" + sfx;
const char2Name = "CleoReal" + sfx;
let n = 0;
const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
const liveRefs = async (name) => (await prisma.referenceImage.count({ where: { deletedAt: null, entity: { ownerId: "founder", name } } }));
const findEntityId = async (name) => (await prisma.entity.findFirst({ where: { ownerId: "founder", name, deletedAt: null }, select: { id: true } }))?.id;

await prisma.entity.deleteMany({ where: { ownerId: "founder", name: { startsWith: "MaraReal" } } }).catch(() => {});
await prisma.entity.deleteMany({ where: { ownerId: "founder", name: { startsWith: "CleoReal" } } }).catch(() => {});

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const snap = async (label) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${label}.png`) }); };
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 160)}`); });

const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();
async function clearEditor() { await editor.click(); await page.keyboard.press("Meta+a"); await page.keyboard.press("Backspace"); }
async function addMention(name) {
  await page.keyboard.type("@"); await page.keyboard.type(name, { delay: 40 });
  await page.locator('[role="option"]', { hasText: name }).first().waitFor({ timeout: 6000 });
  await page.keyboard.press("Enter");
}
async function createCharacterViaUI(name) {
  await page.getByRole("button", { name: "Elements", exact: true }).click();
  await page.getByRole("button", { name: "New element", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("tab", { name: "Character", exact: true }).click();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill(name);
  await page.locator('input[aria-label="Source images"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[role="dialog"] .ref-thumb').first().waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "Save element", exact: true }).click();
  await page.locator(".ref-thumb").first().waitFor({ timeout: 20000 }); // drawer opens with the uploaded ref
}

let passed = false;
let projectId = null;
try {
  // ── login ────────────────────────────────────────────────────────────
  await page.goto(BASE + "/login");
  await page.locator('input[type="email"]').fill("tools@belcort.com");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
  await page.goto((await readFile(".data/last-magic-link.txt", "utf8")).trim());
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await snap("signed-in");
  step("signed in (real magic-link auth flow)");

  // ── fresh project ────────────────────────────────────────────────────
  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Cowork REAL E2E");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
  projectId = new URL(page.url()).searchParams.get("p");
  await snap("project");
  step(`project ${projectId}`);

  // ── create TWO characters fully via UI; delete one's ref → 0 refs ────
  await createCharacterViaUI(char2Name); // keeps its reference
  await snap("cleo-created");
  await createCharacterViaUI(charName);
  await snap("mara-created-with-ref");
  await page.getByRole("button", { name: "Remove reference image" }).first().click();
  for (let i = 0; i < 20 && (await liveRefs(charName)) > 0; i++) await page.waitForTimeout(500);
  if ((await liveRefs(charName)) !== 0) fail(`@${charName} still has refs after UI delete`);
  await snap("mara-ref-deleted-0refs");
  step(`created @${char2Name} (1 ref) and @${charName} via UI, then DELETED @${charName}'s ref → 0 refs (100% UI)`);

  // ── admin: seed the knowledge base ───────────────────────────────────
  await page.goto(BASE + "/admin/directives", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Seed research defaults" }).click();
  await page.getByText(/Inserted|Already seeded/).waitFor({ timeout: 15000 });
  const directives = await prisma.modelDirective.findMany({ where: { ownerId: "founder" } });
  if (directives.length < 6) fail(`only ${directives.length} directives after seed`);
  await snap("admin-seeded");
  step(`ADMIN: ${directives.length} directives in DB`);

  await page.goto(BASE + `/studio?p=${projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Video", exact: true }).click();

  // ── Coach: Kling motion hint, then LTX multi-char (model-tuned) ───────
  const klingPill = page.getByRole("button", { name: /tips? for Kling/ });
  await klingPill.waitFor({ timeout: 8000 });
  await klingPill.click();
  await page.getByText(/concurrent motions/i).first().waitFor({ timeout: 5000 });
  await snap("coach-kling");
  await page.locator('select[aria-label="Video model"]').selectOption("ltx-2");
  await clearEditor();
  await addMention(charName); await page.keyboard.type(" and "); await addMention(char2Name);
  await page.getByRole("button", { name: /tips? for LTX/ }).waitFor({ timeout: 8000 });
  // ensure expanded (don't rely on coachOpen persisting from the Kling step)
  if (!(await page.getByText(/merge multiple characters/i).count())) await page.getByRole("button", { name: /tips? for LTX/ }).click();
  await page.getByText(/merge multiple characters/i).first().waitFor({ timeout: 5000 });
  await snap("coach-ltx-multichar");
  step("COACH: Kling → motion hint; LTX + 2 chars → multi-character warning (model-tuned)");

  // ── real ✨ ENHANCE: real Claude rewrite, @chip survives ─────────────
  await clearEditor();
  await page.keyboard.type("dawn light on "); await addMention(charName); await page.keyboard.type(" by the window");
  const before = (await editor.innerText()).trim();
  await page.getByRole("button", { name: "Enhance prompt" }).click();
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) { await page.waitForTimeout(500); after = (await editor.innerText()).trim(); }
  if (after === before || after.length <= before.length) fail(`Enhance didn't rewrite (real fal): "${after.slice(0, 80)}"`);
  await page.locator(".mention-input .mention", { hasText: charName }).first().waitFor({ timeout: 5000 });
  // PROVE it actually used real fal (not mock): the audit records via=transport.name.
  // mock → "mock"; real → "fal:llm". This is what makes "real" non-spoofable.
  const enhAudit = await prisma.actionEvent.findFirst({ where: { projectId, type: "cowork.enhance" }, orderBy: { createdAt: "desc" }, select: { payload: true } });
  const via = enhAudit?.payload?.via;
  if (via !== "fal:llm") fail(`Enhance did NOT run on real fal — audit via="${via}" (expected "fal:llm"). Is COWORK_PROVIDER=fal + FAL_KEY set?`);
  await snap("enhance-real");
  step(`ENHANCE (real fal, via=${via}): rewrote ${before.length}→${after.length} chars AND kept the @${charName} chip`);

  // ── GUARDIAN: blocks the 0-ref character ($0, NO job) + CTA nav ──────
  await clearEditor();
  await page.keyboard.type("a portrait of "); await addMention(charName);
  const jobsBefore = await prisma.genJob.count({ where: { projectId } });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.getByText(/no reference image/i).first().waitFor({ timeout: 8000 });
  if ((await prisma.genJob.count({ where: { projectId } })) !== jobsBefore) fail("Guardian let a job through (should be $0)");
  await snap("guardian-block");
  await page.getByRole("button", { name: /Add a reference in Elements/ }).click();
  await page.getByRole("button", { name: "New element", exact: true }).waitFor({ timeout: 8000 });
  await snap("guardian-cta-elements");
  step("GUARDIAN: blocked the 0-ref gen ($0, no job); 'Add a reference' CTA reached Elements");

  // ── GUARDIAN pass → REAL generation completes ────────────────────────
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await editor.click();
  await page.keyboard.type("a calm wide shot of a quiet street at dawn, soft light");
  const jobsPre = await prisma.genJob.count({ where: { projectId } });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  if (await page.getByText(/no reference image/i).count()) fail("Guardian wrongly blocked a clean request");
  // bind to the job THIS click created (count increased), not "any recent DONE"
  let newJob = null;
  for (let i = 0; i < 120; i++) {
    const jobs = await prisma.genJob.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true, generationIds: true } });
    if (jobs.length > jobsPre) {
      const latest = jobs[0];
      if (latest.status === "FAILED") fail(`the clean Generate FAILED: ${latest.error?.slice(0, 140)}`);
      if (latest.status === "DONE") { newJob = latest; break; }
    }
    await page.waitForTimeout(1000);
  }
  if (!newJob) fail("the clean Generate did not create a job that reached DONE within 120s");
  const genRow = await prisma.generation.count({ where: { id: { in: newJob.generationIds }, deletedAt: null } });
  if (genRow < 1) fail("the clean Generate job produced no Generation");
  // the served result image must actually LOAD — a 404/broken image must FAIL, not be ignored
  const resImg = page.locator('img[src*="/files/"]').last();
  await resImg.waitFor({ timeout: 20000 });
  if (!(await resImg.evaluate((n) => n.naturalWidth > 0).catch(() => false))) fail("clean gen image present but did not load (broken/404)");
  await snap("guardian-pass-real-gen");
  step(`GUARDIAN: clean request passed AND really generated (new job ${newJob.id.slice(0, 8)} DONE, image loaded) — real fal`);

  // ── real cowork DRAFT ────────────────────────────────────────────────
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.locator('input[aria-label="Ask cowork"]').fill("a moody coffee ad: a barista crafts a latte at dawn in a quiet cafe");
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  let drafted = 0;
  for (let i = 0; i < 60 && drafted < 3; i++) { drafted = await prisma.shot.count({ where: { projectId, deletedAt: null } }); if (drafted < 3) await page.waitForTimeout(1000); }
  if (drafted < 3) fail(`cowork draft created only ${drafted} shots`);
  await snap("cowork-draft-real");
  step(`COWORK (real fal): drafted ${drafted} shots from one idea`);

  const shots = await prisma.shot.findMany({ where: { projectId, deletedAt: null } });
  if (shots.some((s) => !s.description?.trim())) fail("a drafted shot has no prompt");
  step(`DB proof: ${shots.length} shots; sample: "${shots[0].description.slice(0, 70)}…"`);
  passed = true;
} finally {
  await browser.close().catch(() => {});
  // clean the seeded test characters (refs + shotRefs first, then the entity)
  for (const nm of [charName, char2Name]) {
    const id = await findEntityId(nm);
    if (id) { await prisma.referenceImage.deleteMany({ where: { entityId: id } }).catch(() => {}); await prisma.shotEntityRef.deleteMany({ where: { entityId: id } }).catch(() => {}); }
  }
  await prisma.entity.deleteMany({ where: { ownerId: "founder", name: { in: [charName, char2Name] } } }).catch(() => {});
  // clean the throwaway test project (FK order: generations before shots; project last)
  if (projectId) {
    await prisma.genJob.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.generation.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.shotEntityRef.deleteMany({ where: { shot: { projectId } } }).catch(() => {});
    await prisma.shot.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.actionEvent.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
}

const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|preload|\/files\/.*404|Failed to load resource|favicon/.test(e));
console.log(`\nscreenshots → ${OUT}`);
if (fatal.length) { console.log("PAGE ERRORS (failing the run):"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
if (!passed) process.exit(1);
console.log("COWORK 100%-REAL E2E PASSED — UI-created 0-ref char · Coach · real Enhance · Guardian(block+CTA+pass→REAL gen) · real draft");
process.exit(0);
