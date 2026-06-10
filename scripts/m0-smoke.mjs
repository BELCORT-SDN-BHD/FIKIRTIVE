// M0 full-journey smoke: entity library → shot board → @composer → candidate
// upload → manual attach → history. Screenshots to ~/.gstack/projects/artlio/m0-smoke/
// Expects a fresh DB (re-runs collide with leftover entities):
//   docker exec artlio-postgres-1 psql -U artlio -d artlio -c 'TRUNCATE "ActionEvent","Generation","ShotEntityRef","Shot","ReferenceImage","Asset","Entity","TemplateBundle","Project" CASCADE;'
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = path.join(os.homedir(), ".gstack/projects/artlio/m0-smoke");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const snap = (name) => page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
const step = (msg) => console.log(`✓ ${msg}`);

// --- fixture images: render colored canvases and screenshot them ---
async function makeImage(file, color, label, w = 1280, h = 720) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(
    `<body style="margin:0;background:${color};display:grid;place-items:center;
      font:700 64px sans-serif;color:#fff">${label}</body>`,
  );
  await p.screenshot({ path: file });
  await p.close();
}
await makeImage("/tmp/ref-maya.png", "#b85c38", "MAYA REF", 800, 800);
await makeImage("/tmp/ref-alley.png", "#2f6f5f", "NEON ALLEY REF", 800, 800);
await makeImage("/tmp/render-1.png", "#3a2f55", "RENDER v1");
step("fixtures ready");

// --- 1. empty workbench ---
await page.goto(BASE);
await page.getByText("Entity Library").waitFor();
await snap("01-empty.png");
step("workbench loads (empty states visible)");

// --- 2. create entities ---
async function createEntity(name, type, img) {
  await page.fill('nav input[name="name"]', name);
  await page.selectOption('nav select[name="type"]', type);
  await page.setInputFiles('nav input[name="files"]', img);
  await page.getByRole("button", { name: "Create entity" }).click();
  await page.locator("nav").getByText(name, { exact: true }).waitFor({ timeout: 15000 });
}
await createEntity("Maya", "CHARACTER", "/tmp/ref-maya.png");
await createEntity("Neon Alley", "LOCATION", "/tmp/ref-alley.png");
await snap("02-entities.png");
step("entities created with reference images");

// --- 3. first shot via composer guide ---
await page.getByRole("button", { name: "Add Shot 01", exact: true }).click();
await page.getByText("SHOT 01", { exact: true }).waitFor({ timeout: 15000 });
step("shot 01 created");

// --- 4. @composer: mention both entities ---
const editor = page.locator(".composer .tiptap");
await editor.click();
await page.keyboard.type("Cinematic dolly shot of @May", { delay: 25 });
await page.locator('[aria-label="Entity suggestions"] [role="option"]').first().waitFor({ timeout: 5000 });
await snap("03-mention-dropdown.png");
await page.keyboard.press("Enter");
await page.keyboard.type("walking through @Neon", { delay: 25 });
await page.locator('[aria-label="Entity suggestions"] [role="option"]').first().waitFor({ timeout: 5000 });
await page.keyboard.press("Enter");
await page.keyboard.type("at night, heavy rain", { delay: 25 });
await page.getByRole("button", { name: "Save prompt" }).click();
await page.locator('[aria-label="Shot board"] .mention', { hasText: "@Maya" }).first().waitFor({ timeout: 15000 });
await snap("04-prompt-saved.png");
step("prompt saved — chips visible on shot card");

// --- 5. copy resolved prompt ---
await page.getByRole("button", { name: "Copy resolved prompt" }).click();
await page.getByText("Copied ✓").waitFor();
const clip = await page.evaluate(() => navigator.clipboard.readText());
if (!clip.includes("Maya") || !clip.includes("Neon Alley"))
  throw new Error(`resolved prompt wrong: ${clip}`);
step(`resolved prompt copies clean: "${clip.slice(0, 60)}…"`);

// --- 6. upload candidate ---
await page.setInputFiles('aside input[type="file"]', "/tmp/render-1.png");
await page.locator("aside li").first().waitFor({ timeout: 20000 });
await snap("05-candidate.png");
step("candidate uploaded (carries shot prompt + entities)");

// --- 7. attach via dropdown ---
await page.locator('aside select[aria-label="Attach to shot"]').selectOption({ index: 1 });
await page.locator("aside").getByText("v1").waitFor({ timeout: 15000 });
await snap("06-attached.png");
step("candidate attached → history v1");

// --- 8. shot card reflects ATTACHED + thumbnail ---
const status = await page.locator('main select[aria-label="Shot status"]').inputValue();
if (status !== "ATTACHED") throw new Error(`shot status is ${status}, expected ATTACHED`);
step("shot status auto-moved to ATTACHED");

// --- 9. detach back to candidates ---
await page.getByRole("button", { name: "Detach → candidates" }).click();
await page.locator('aside select[aria-label="Attach to shot"]').waitFor({ timeout: 15000 });
step("detach returns generation to candidate zone");
await snap("07-final.png");

const fatal = errors.filter(
  (e) => !e.includes("favicon") && !e.includes("Download the React DevTools"),
);
if (fatal.length) {
  console.log("CONSOLE ERRORS:");
  for (const e of fatal) console.log("  " + e);
  process.exitCode = 1;
} else {
  console.log("\nALL STEPS PASSED — screenshots in " + SHOTS);
}
await browser.close();
