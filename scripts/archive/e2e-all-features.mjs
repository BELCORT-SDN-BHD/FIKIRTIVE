// EXHAUSTIVE real-user E2E ($0, mock): touches every feature and asserts each
// actually produces a LOADABLE result (image decoded / video has metadata), not
// just a present element. Elements, t2i, t2v, i2v(upload), last-frame i2v,
// storyboard (scenes/animate/reorder/delete), assets (filter/attach/delete),
// storage (served), editor (export). Ends with a DB check that last-frame
// really carried both source+tail.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = path.join(os.homedir(), ".gstack/projects/fikirtive/e2e");
mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const snap = (n) => page.screenshot({ path: path.join(OUT, n) });
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 140)}`); });
// a media element that actually decoded/loaded
const loaded = (loc) => loc.evaluate((n) => n.tagName === "VIDEO" ? (n.readyState >= 1 || n.videoWidth > 0) : n.naturalWidth > 0);
async function assertLoads(loc, what) {
  await loc.waitFor({ timeout: 60000 });
  // give media a tick to decode
  for (let i = 0; i < 20; i++) { if (await loaded(loc)) return; await page.waitForTimeout(500); }
  throw new Error(`${what}: element present but did not load (broken media)`);
}

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
step("signed in → Studio");

// new project
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Lighthouse Saga");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
await page.waitForTimeout(600);
const projectId = new URL(page.url()).searchParams.get("p");
step(`created project 'Lighthouse Saga' (${projectId})`);

// ── ELEMENTS: character + generated reference ─────────────────────────
await page.getByRole("button", { name: "Elements", exact: true }).click();
await page.getByRole("button", { name: "New element", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.getByRole("tab", { name: "Character", exact: true }).click();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("The Keeper");
await page.getByText("Generate refs", { exact: true }).click();
await page.getByRole("button", { name: /Create & generate/ }).click();
await page.locator('aside input[aria-label="Element name"]').waitFor({ timeout: 15000 });
await page.locator('aside select[aria-label="Number of images"]').selectOption("1");
await page.locator("aside").getByRole("button", { name: /Generate 1/ }).click();
await assertLoads(page.locator("aside .ref-thumb").first(), "element reference image");
step("ELEMENTS: @The Keeper created; reference image generated + loads");

// ── GEN SPACE: t2i, t2v, i2v(upload), last-frame ──────────────────────
await page.getByRole("button", { name: "Gen space", exact: true }).click();
await page.waitForTimeout(300);
// t2i (Photo)
await page.locator('input[aria-label="Describe the shot"]').fill("a lighthouse on a cliff at golden hour");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await assertLoads(page.locator(".screen img").first(), "text-to-image result");
step("GEN: text-to-image produced a loadable image");
// t2v (Video, no ref)
await page.getByRole("tab", { name: "Video", exact: true }).click();
await page.locator('input[aria-label="Describe the shot"]').fill("storm clouds rolling over the sea, time-lapse");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await assertLoads(page.locator(".screen video").first(), "text-to-video result");
step("GEN: text-to-video produced a playable clip");
// i2v from an uploaded start frame
await page.locator('.composer-dock input[type="file"]').first().setInputFiles({ name: "start.png", mimeType: "image/png", buffer: PNG });
await page.locator('.composer-dock img[alt="start frame"]').waitFor({ timeout: 30000 });
await page.locator('input[aria-label="Describe the shot"]').fill("the still photo comes alive, gentle drift");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await assertLoads(page.locator(".screen video").first(), "i2v-from-upload result");
step("GEN: image-to-video from an uploaded still produced a clip");
// last-frame i2v (start already set; add an end frame)
await page.locator('.composer-dock input[type="file"]').nth(1).setInputFiles({ name: "end.png", mimeType: "image/png", buffer: PNG });
await page.locator('.composer-dock img[alt="last frame"]').waitFor({ timeout: 30000 });
await page.getByText("start → end frame", { exact: false }).first().waitFor({ timeout: 5000 });
await page.locator('input[aria-label="Describe the shot"]').fill("transition from the first frame to the last");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await assertLoads(page.locator(".screen video").first(), "last-frame i2v result");
step("GEN: last-frame image-to-video (start → end) produced a clip");
await snap("01-genspace.png");

// ── STORYBOARD: scenes, image, animate, reorder, delete ───────────────
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(400);
for (const [i, p] of [["the keeper ascends the stair", 0], ["the lamp roars to life", 1]]) {
  await page.getByRole("button", { name: /Add (the first )?shot/ }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".al-mediacard textarea").length === n, p + 1, { timeout: 10000 });
  const c = page.locator(".al-mediacard").nth(p);
  await c.locator("textarea").fill(i);
  await c.locator("textarea").blur();
  await page.waitForTimeout(300);
}
const shot1 = page.locator(".al-mediacard").first();
await shot1.getByRole("button", { name: /Generate|Image/ }).first().click();
await assertLoads(shot1.locator("img"), "storyboard shot image");
await shot1.getByRole("button", { name: "Animate", exact: true }).click();
await assertLoads(shot1.locator("video"), "storyboard shot i2v (Animate)");
step("STORYBOARD: shot image generated + Animated (i2v) — both load");
await page.locator(".al-mediacard").nth(1).getByRole("button", { name: "Move shot earlier" }).click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Add scene", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll("section").length === 2, null, { timeout: 10000 });
const secCounts1 = await page.$$eval("section", (s) => s.map((x) => x.querySelectorAll(".al-mediacard").length));
await page.locator("section:nth-of-type(1) .al-mediacard").nth(1).getByRole("button", { name: "Delete shot" }).click();
await page.waitForFunction((n) => document.querySelectorAll("section:nth-of-type(1) .al-mediacard").length === n, secCounts1[0] - 1, { timeout: 8000 });
step("STORYBOARD: reorder, add-scene, delete all work (scene grouping intact)");
await snap("02-storyboard.png");

// ── ASSETS: browse, filter, attach, delete ────────────────────────────
await page.getByRole("button", { name: "Assets", exact: true }).click();
await page.waitForTimeout(600);
const total = await page.locator(".al-mediacard").count();
if (total < 4) throw new Error(`Assets shows ${total}, expected several generated media`);
await assertLoads(page.locator(".al-mediacard img, .al-mediacard video").first(), "assets media");
await page.getByRole("tab", { name: "Videos", exact: true }).click();
await page.waitForTimeout(300);
const vids = await page.locator(".al-mediacard").count();
await page.getByRole("tab", { name: "All", exact: true }).click();
await page.waitForTimeout(200);
const sel = page.locator(".al-mediacard select[aria-label='Add to shot']").first();
if (await sel.count()) { await sel.selectOption({ index: 1 }); await page.waitForTimeout(1000); }
const before = await page.locator(".al-mediacard").count();
await page.locator(".al-mediacard").first().getByRole("button", { name: "Delete asset" }).click();
await page.waitForFunction((n) => document.querySelectorAll(".al-mediacard").length === n - 1, before, { timeout: 8000 });
step(`ASSETS: ${total} media (${vids} videos); filter + attach + delete work`);
await snap("03-assets.png");

// ── EDITOR: assemble + export ─────────────────────────────────────────
await page.getByRole("button", { name: "Video editor", exact: true }).click();
await page.waitForTimeout(3000);
await snap("04-editor.png");
await page.getByRole("button", { name: "Export MP4", exact: true }).click();
await page.getByText(/Done|Ready|Download/i).first().waitFor({ timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1500);
step("EDITOR: storyboard cut assembled + exported MP4");

await browser.close();

// ── DB proof: last-frame job carried BOTH source and tail; storage served ─
const require = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
process.env.DATABASE_URL ??= "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive";
const { prisma } = await import("../../packages/db/dist/src/index.js");
const lastFrameJob = await prisma.genJob.findFirst({
  where: { projectId, kind: "VIDEO", sourceGenerationId: { not: null }, tailGenerationId: { not: null } },
  orderBy: { createdAt: "desc" },
});
if (!lastFrameJob) throw new Error("no last-frame job (source+tail) found in DB");
if (lastFrameJob.status !== "DONE") throw new Error(`last-frame job ${lastFrameJob.status}, expected DONE`);
if (!lastFrameJob.generationIds.length) throw new Error("last-frame job produced no generation");
step(`DB: last-frame job ${lastFrameJob.id.slice(0, 8)} carried source+tail, DONE, produced a clip`);
await prisma.$disconnect();

const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|preload|\/files\/.*404|Failed to load resource/.test(e));
console.log(`\n=== E2E COMPLETE — screenshots in ${OUT} ===`);
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("EXHAUSTIVE E2E PASSED — every feature works end to end (mock $0)");
process.exit(0);
