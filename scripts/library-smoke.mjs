// Library-page smoke: gallery render → alias add → typed create → sidebar alias search → @alias mention.
// Expects m0-smoke data already present (Maya / Neon Alley / Shot 01 saved prompt). BASE_URL overrides :3000.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = path.join(os.homedir(), ".gstack/projects/artlio/m0-smoke");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
const step = (m) => console.log(`✓ ${m}`);

// fixture image
const fx = await ctx.newPage();
await fx.setViewportSize({ width: 800, height: 800 });
await fx.setContent('<body style="margin:0;background:#7a5c8f;display:grid;place-items:center;font:700 48px sans-serif;color:#fff">BOTTLE REF</body>');
await fx.screenshot({ path: "/tmp/ref-bottle.png" });
await fx.close();

// --- 1. library page renders: existing entities + empty hints ---
await page.goto(BASE + "/library");
await page.getByText("Subject Library").waitFor();
await page.getByText("Maya", { exact: true }).waitFor();
await page.getByText("Neon Alley", { exact: true }).waitFor();
await page.getByText("Create your first product").waitFor();
await page.screenshot({ path: path.join(SHOTS, "08-library.png") });
step("library renders: cards + actionable empty sections");

// --- 2. open Maya detail, add alias ---
await page.getByRole("button", { name: /Maya/ }).click();
await page.getByRole("heading", { name: "Subject Library" }).waitFor();
await page.locator('aside input[aria-label="Add alias (press Enter)"]').fill("the girl");
await page.keyboard.press("Enter");
await page.locator("aside .alias-chip", { hasText: "the girl" }).waitFor({ timeout: 15000 });
step("alias added via detail drawer");
await page.screenshot({ path: path.join(SHOTS, "09-detail.png") });

// --- 3. create a product from the empty-section CTA ---
await page.getByRole("button", { name: "+ New product" }).click();
await page.locator('aside input[placeholder="Product name"]').fill("Aurora Bottle");
await page.setInputFiles('aside input[type="file"]', "/tmp/ref-bottle.png");
await page.getByRole("button", { name: "Create product" }).click();
await page.locator('aside input[aria-label="Entity name"]').waitFor({ timeout: 20000 });
const created = await page.locator('aside input[aria-label="Entity name"]').inputValue();
if (created !== "Aurora Bottle") throw new Error(`detail shows "${created}"`);
step("product created from section CTA → drawer flips to detail");

// --- 4. workbench sidebar: search by alias, row links to library ---
await page.goto(BASE + "/");
await page.getByText("Subjects").first().waitFor();
await page.locator('nav input[type="search"]').fill("girl");
await page.locator("nav").getByText("Maya", { exact: true }).waitFor({ timeout: 5000 });
step("sidebar search matches alias 'girl' → Maya");

// --- 5. composer: @ search by alias inserts the real name chip ---
const editor = page.locator(".composer .tiptap");
await editor.click();
await page.keyboard.press("Meta+a");
await page.keyboard.type("close-up of @girl", { delay: 25 });
const opt = page.locator('[aria-label="Entity suggestions"] [role="option"]').first();
await opt.waitFor({ timeout: 5000 });
const optText = await opt.innerText();
if (!optText.includes("aka the girl")) throw new Error(`dropdown shows: ${optText}`);
await page.keyboard.press("Enter");
await page.locator(".composer .mention", { hasText: "@Maya" }).waitFor({ timeout: 5000 });
step("@girl resolves to @Maya chip (alias-aware mention)");
await page.screenshot({ path: path.join(SHOTS, "10-alias-mention.png") });

const fatal = errors.filter((e) => !e.includes("favicon") && !e.includes("React DevTools"));
if (fatal.length) { console.log("CONSOLE ERRORS:"); fatal.forEach((e) => console.log("  " + e)); process.exitCode = 1; }
else console.log("\nLIBRARY PROBE PASSED");
await browser.close();
