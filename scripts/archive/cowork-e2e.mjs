// Cowork features E2E ($0, mock) — mimics a real user exercising the whole cowork
// arc end-to-end and asserts the actual behaviors, not just clicks:
//   admin seed: populate the per-(family×mode) knowledge base (DB write proven)
//   Coach: model-TUNED $0 hints — Kling shows a motion ceiling, LTX shows a
//          multi-character warning (DIFFERENT hints per model ⇒ DB-driven, not hardcoded)
//   Enhance: model-aware rewrite that KEEPS the @mention chip (the wedge)
//   Guardian: blocks a paid gen on a CHARACTER with no refs ($0, NO job); its "Add a
//             reference" CTA navigates to Elements; a clean request passes AND creates a job
//   cowork: draft a storyboard from one idea
//
// Two 0-ref characters are seeded via prisma (deliberate arrange — the create dialog
// forces a reference, so a 0-ref character only happens by deleting refs). Everything
// else is driven through the UI as a real user.
//
// SCOPE NOTES (covered elsewhere, not here): the SERVER Guardian backstop only fires
// on a client bypass (unreachable via faithful UI) — covered by castFindings unit tests
// + the checkCast code review. The admin SAVE-a-cell path is covered by the
// modelDirectiveInput unit tests + the saveModelDirective Codex review. Mock cowork
// ignores the injected directive (only real fal reads it), so directive→Enhance text
// isn't observable at $0; we prove DB-driven via Coach's per-model hint divergence.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../../packages/db/dist/src/index.js");
const { newId } = await import("../../packages/core/dist/index.js");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
const sfx = Date.now().toString(36).slice(-4);
const charName = "MaraE2E" + sfx;
const char2Name = "CleoE2E" + sfx;

// best-effort cleanup of leftovers from any crashed prior run
await prisma.entity.deleteMany({ where: { ownerId: "founder", name: { startsWith: "MaraE2E" } } }).catch(() => {});
await prisma.entity.deleteMany({ where: { ownerId: "founder", name: { startsWith: "CleoE2E" } } }).catch(() => {});

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 160)}`); });

const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();
async function clearEditor() {
  await editor.click();
  await page.keyboard.press("Meta+a"); // macOS select-all (Control+a is NOT select-all here)
  await page.keyboard.press("Backspace");
}
async function addMention(name) {
  await page.keyboard.type("@");
  await page.keyboard.type(name, { delay: 40 });
  await page.locator('[role="option"]', { hasText: name }).first().waitFor({ timeout: 6000 });
  await page.keyboard.press("Enter"); // pick the highlighted suggestion
}

let passed = false;
try {
  // ── login (dev magic link → .data file) ──────────────────────────────
  await page.goto(BASE + "/login");
  await page.locator('input[type="email"]').fill("tools@belcort.com");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
  await page.goto((await readFile(".data/last-magic-link.txt", "utf8")).trim());
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  step("signed in");

  // ── fresh project ────────────────────────────────────────────────────
  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Cowork E2E");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
  const projectId = new URL(page.url()).searchParams.get("p");
  step(`project ${projectId}`);

  // ── arrange: TWO CHARACTERs with ZERO reference images ───────────────
  await prisma.entity.create({ data: { id: newId(), ownerId: "founder", type: "CHARACTER", name: charName } });
  await prisma.entity.create({ data: { id: newId(), ownerId: "founder", type: "CHARACTER", name: char2Name } });
  step(`seeded 0-ref CHARACTERs @${charName} + @${char2Name}`);

  // ── 1) ADMIN: seed the per-(family×mode) knowledge base ──────────────
  await page.goto(BASE + "/admin/directives", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Seed research defaults" }).click();
  await page.getByText(/Inserted|Already seeded/).waitFor({ timeout: 15000 });
  const directives = await prisma.modelDirective.findMany({ where: { ownerId: "founder" } });
  if (directives.length < 6) fail(`only ${directives.length} directives after seed (expected ≥6)`);
  if (!directives.find((d) => d.family === "kling" && d.mode === "t2v")?.directive.trim()) fail("kling/t2v directive missing after seed");
  if (!directives.find((d) => d.family === "ltx" && d.mode === "t2v")?.rules) fail("ltx/t2v cast rule missing after seed");
  step(`ADMIN: seeded ${directives.length} directives (kling motion rule + ltx cast rule present)`);

  // reload studio so the page re-renders with the seeded rules + the new @entities
  await page.goto(BASE + `/studio?p=${projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Video", exact: true }).click();

  // ── 2) COACH: Kling shows its motion-ceiling hint ────────────────────
  const klingPill = page.getByRole("button", { name: /tips? for Kling/ });
  await klingPill.waitFor({ timeout: 8000 });
  await klingPill.click();
  await page.getByText(/concurrent motions/i).first().waitFor({ timeout: 5000 });
  step("COACH: Kling → motion-ceiling hint");

  // ── 3) COACH: a DIFFERENT model (LTX) + 2 characters → multi-char warn ─
  //     (different hint per model ⇒ Coach reads the DB, isn't hardcoded)
  await page.locator('select[aria-label="Video model"]').selectOption("ltx-2");
  await clearEditor();
  await addMention(charName); await page.keyboard.type(" and "); await addMention(char2Name);
  // the pill is still EXPANDED from step 2 (coachOpen persists), so the new LTX
  // hints render live — don't re-click (that would collapse it)
  await page.getByRole("button", { name: /tips? for LTX/ }).waitFor({ timeout: 8000 });
  await page.getByText(/merge multiple characters/i).first().waitFor({ timeout: 5000 });
  step("COACH: LTX + 2 characters → multi-character warning (model-tuned, DB-driven)");

  // ── 4) ENHANCE: rewrite KEEPS the @mention chip (the wedge) ──────────
  await clearEditor();
  await page.keyboard.type("a slow push-in on "); await addMention(charName); await page.keyboard.type(" at the window");
  await page.locator(".mention-input .mention", { hasText: charName }).first().waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Enhance prompt" }).click();
  // state-wait: the editor re-seeds with the rewritten text (mock appends qualifiers)
  await page.locator(".mention-input", { hasText: /cinematic lighting/i }).first().waitFor({ timeout: 10000 });
  await page.locator(".mention-input .mention", { hasText: charName }).first().waitFor({ timeout: 5000 });
  step("ENHANCE: prompt rewritten AND the @mention chip survived (entity binding intact)");

  // ── 5) GUARDIAN: blocks the 0-ref character ($0, NO job) + CTA nav ───
  await clearEditor();
  await page.keyboard.type("a portrait of "); await addMention(charName);
  const jobsBefore = await prisma.genJob.count({ where: { projectId } });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.getByText(/no reference image/i).first().waitFor({ timeout: 8000 });
  if ((await prisma.genJob.count({ where: { projectId } })) !== jobsBefore) fail("Guardian let a job through (should be $0, no job)");
  step("GUARDIAN: blocked the no-ref generation — amber bar, $0, no job");
  // the bar's "Add a reference in Elements" CTA actually navigates to Elements
  await page.getByRole("button", { name: /Add a reference in Elements/ }).click();
  await page.getByRole("button", { name: "New element", exact: true }).waitFor({ timeout: 8000 });
  step("GUARDIAN: the 'Add a reference' CTA navigates to Elements (fixable, not a dead end)");

  // ── 6) GUARDIAN passes a clean request AND it creates a job ──────────
  await page.getByRole("button", { name: "Gen space", exact: true }).click(); // composer remounts fresh
  await editor.click();
  await page.keyboard.type("a calm wide shot of a quiet street at dawn");
  const jobsPre = await prisma.genJob.count({ where: { projectId } });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  let jobsPost = jobsPre;
  for (let i = 0; i < 15 && jobsPost <= jobsPre; i++) { jobsPost = await prisma.genJob.count({ where: { projectId } }); if (jobsPost <= jobsPre) await page.waitForTimeout(500); }
  if (await page.getByText(/no reference image/i).count()) fail("Guardian wrongly blocked a clean request");
  if (jobsPost <= jobsPre) fail("clean request created no GenJob (Guardian over-blocked or gen never started)");
  step("GUARDIAN: a clean request is NOT blocked AND it created a job (additive-only, lets work through)");

  // ── 7) COWORK: draft a storyboard from one idea ─────────────────────
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.locator('input[aria-label="Ask cowork"]').fill("a moody coffee ad: a barista crafts a latte at dawn in a quiet cafe");
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  let drafted = 0;
  for (let i = 0; i < 30 && drafted < 3; i++) { drafted = await prisma.shot.count({ where: { projectId, deletedAt: null } }); if (drafted < 3) await page.waitForTimeout(1000); }
  if (drafted < 3) fail(`cowork draft created only ${drafted} shots`);
  step(`COWORK: drafted a storyboard from one idea → ${drafted} shots`);

  // ── DB proof ─────────────────────────────────────────────────────────
  const shots = await prisma.shot.findMany({ where: { projectId, deletedAt: null } });
  if (shots.some((s) => !s.description?.trim())) fail("a drafted shot has no prompt");
  step(`DB: ${shots.length} shots drafted, each with a prompt; ${directives.length} directives seeded`);
  passed = true;
} finally {
  await browser.close().catch(() => {});
  await prisma.entity.deleteMany({ where: { ownerId: "founder", name: { in: [charName, char2Name] } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}

const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|preload|\/files\/.*404|Failed to load resource|favicon/.test(e));
if (fatal.length) { console.log("\nPAGE ERRORS:"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
if (!passed) process.exit(1);
console.log("\nCOWORK E2E PASSED — admin seed · Coach(Kling+LTX) · Enhance(+@chip) · Guardian(block+CTA+pass→job) · draft (mock $0)");
process.exit(0);
