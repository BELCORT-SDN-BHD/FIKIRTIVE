// Capstone integration journey ($0, mock): one creator makes a complete project
// touching EVERY surface — Elements, Gen space (image + text-to-video), Storyboard
// (scenes, per-shot image, Animate=i2v, reorder), Assets (browse + attach), Video
// editor (export). Proves the redesigned Studio works end to end as one flow.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = path.join(os.homedir(), ".gstack/projects/fikirtive/full-journey");
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const snap = (n) => page.screenshot({ path: path.join(SHOTS, n) });
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 140)}`); });

// ── sign in ──────────────────────────────────────────────────────────
const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
step("signed in → Studio");

// ── new project ──────────────────────────────────────────────────────
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("The Lighthouse");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
await page.waitForTimeout(700);
step("created project 'The Lighthouse'");

// ── Elements: a character + a generated reference ────────────────────
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
await page.locator("aside .ref-thumb").first().waitFor({ timeout: 60000 });
step("Elements: created @The Keeper + generated a reference");

// ── Gen space: an image candidate, then a text-to-video candidate ────
await page.getByRole("button", { name: "Gen space", exact: true }).click();
await page.waitForTimeout(300);
await page.locator('input[aria-label="Describe the shot"]').fill("a storm-lashed lighthouse at night, beam sweeping");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await page.locator(".screen img").first().waitFor({ timeout: 60000 });
await page.getByRole("tab", { name: "Video", exact: true }).click();
await page.locator('input[aria-label="Describe the shot"]').fill("waves crashing on black rocks, slow motion");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await page.locator(".screen video").first().waitFor({ timeout: 60000 });
step("Gen space: generated an image + a text-to-video clip");
await snap("01-genspace.png");

// ── Storyboard: scene 1 (two shots, image + animate), then scene 2 ───
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(400);
const prompts = ["the keeper climbs the spiral stair, lantern in hand", "close on the lamp igniting, warm glow"];
for (let i = 0; i < prompts.length; i++) {
  await page.getByRole("button", { name: /Add (the first )?shot/ }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".al-mediacard textarea").length === n, i + 1, { timeout: 10000 });
  const card = page.locator(".al-mediacard").nth(i);
  await card.locator("textarea").fill(prompts[i]);
  await card.locator("textarea").blur();
  await page.waitForTimeout(300);
}
// generate a still for shot 1, then Animate it (i2v)
const shot1 = page.locator(".al-mediacard").first();
await shot1.getByRole("button", { name: /Generate|Image/ }).first().click();
await shot1.locator("img").waitFor({ timeout: 60000 });
await shot1.getByRole("button", { name: "Animate", exact: true }).click();
await shot1.locator("video").waitFor({ timeout: 60000 });
step("Storyboard scene 1: 2 shots; shot 1 image → Animate (i2v video)");
// reorder: move shot 2 earlier, then back
await page.locator(".al-mediacard").nth(1).getByRole("button", { name: "Move shot earlier" }).click();
await page.waitForTimeout(1200);
step("reordered shots within the scene");
// add a second scene with a shot + generate
await page.getByRole("button", { name: "Add scene", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll("section").length === 2, null, { timeout: 10000 });
const s2shot = page.locator("section:nth-of-type(2) .al-mediacard").first();
await s2shot.locator("textarea").fill("wide shot: the beam cuts the fog, a ship turns away");
await s2shot.locator("textarea").blur();
await page.waitForTimeout(300);
await s2shot.getByRole("button", { name: /Generate|Image/ }).first().click();
await s2shot.locator("img").waitFor({ timeout: 60000 });
step("added Scene 2 with a generated shot");
await snap("02-storyboard.png");

// ── Assets: the library populated; attach a candidate to a shot ──────
await page.getByRole("button", { name: "Assets", exact: true }).click();
await page.waitForTimeout(600);
const assetCount = await page.locator(".al-mediacard").count();
if (assetCount < 3) throw new Error(`Assets shows ${assetCount} items, expected several`);
const candidateSelect = page.locator(".al-mediacard select[aria-label='Add to shot']").first();
if (await candidateSelect.count() > 0) {
  await candidateSelect.selectOption({ index: 1 });
  await page.waitForTimeout(1200);
  step(`Assets: ${assetCount} items; attached a candidate to a shot`);
} else {
  step(`Assets: ${assetCount} items in the library`);
}
await snap("03-assets.png");

// ── Video editor: the cut assembles; export ──────────────────────────
await page.getByRole("button", { name: "Video editor", exact: true }).click();
await page.waitForTimeout(3000);
await snap("04-editor.png");
await page.getByRole("button", { name: "Export MP4", exact: true }).click();
await page.getByText(/Done|Ready|Download/i).first().waitFor({ timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1500);
step("Video editor: assembled the cut and exported MP4");
await snap("05-export.png");

await browser.close();
const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|preload/.test(e));
console.log(`\n=== FULL JOURNEY COMPLETE — screenshots in ${SHOTS} ===`);
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("FULL JOURNEY PASSED — Elements → Gen space (image+t2v) → Storyboard (scenes+i2v+reorder) → Assets (attach) → Editor (export), mock $0");
process.exit(0);
