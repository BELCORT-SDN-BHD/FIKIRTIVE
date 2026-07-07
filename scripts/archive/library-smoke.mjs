// Library smoke: elements grid → alias add in drawer → typed create via dialog
// (Generate door) → search by alias → @alias mention in the composer dock.
// Expects m0-smoke data already present (Maya / Neon Alley / Shot 01 saved prompt).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = path.join(os.homedir(), ".gstack/projects/fikirtive/m0-smoke");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
const step = (m) => console.log(`✓ ${m}`);

// --- auth prelude: magic-link login via the dev link file ---
async function login(page) {
  const fs = await import("node:fs/promises");
  await page.goto(BASE + "/login");
  await page.locator('input[type="email"]').fill("tools@belcort.com");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
  const url = (await fs.readFile(".data/last-magic-link.txt", "utf8")).trim();
  await page.goto(url);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

await login(page);
step("signed in via magic link");

// --- 1. library renders: cards + actionable empty sections ---
await page.goto(BASE + "/library");
await page.getByText("@Maya", { exact: true }).waitFor();
await page.getByText("@Neon Alley", { exact: true }).waitFor();
await page.getByText("Create your first product").waitFor();
await page.screenshot({ path: path.join(SHOTS, "08-library.png") });
step("library renders: element cards + actionable empty sections");

// --- 2. open Maya detail, add alias ---
await page.getByText("@Maya", { exact: true }).click();
await page.locator('aside input[aria-label="Add alias (press Enter)"]').fill("the girl");
await page.keyboard.press("Enter");
await page.locator("aside .alias-chip", { hasText: "the girl" }).waitFor({ timeout: 15000 });
step("alias added via detail drawer");
await page.screenshot({ path: path.join(SHOTS, "09-detail.png") });

// --- 3. create a product via the Generate door ---
await page.getByRole("button", { name: "+ New product" }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Aurora Bottle");
await page.getByRole("tab", { name: "Generate refs" }).click();
await page.getByRole("button", { name: "Create & generate refs →" }).click();
// drawer is keyed by entity id — wait for it to remount onto the new product
// ("Generate references" now also shows for entities-with-refs, so anchor on
// the unique name instead)
await page.waitForFunction(
  () => document.querySelector('aside input[aria-label="Element name"]')?.value === "Aurora Bottle",
  { timeout: 15000 },
);
await page.locator("aside").getByText("Generate references").waitFor({ timeout: 15000 });
step("product created via Generate door → drawer shows generation control");
await page.screenshot({ path: path.join(SHOTS, "10-generate-door.png") });

// --- 4. search matches alias ---
await page.locator('input[aria-label="Search elements"]').fill("girl");
await page.getByText("@Maya", { exact: true }).waitFor({ timeout: 5000 });
step("library search matches alias 'girl' → @Maya");

// --- 5. composer: @ search by alias inserts the real name chip ---
await page.goto(BASE + "/");
await page.getByText("Shot board", { exact: true }).waitFor();
const editor = page.locator(".al-promptbar .tiptap");
await editor.click();
await page.keyboard.press("Meta+a");
await page.keyboard.type("close-up of @girl", { delay: 25 });
const opt = page.locator('[aria-label="Entity suggestions"] [role="option"]').first();
await opt.waitFor({ timeout: 5000 });
const optText = await opt.innerText();
if (!optText.includes("aka the girl")) throw new Error(`dropdown shows: ${optText}`);
await page.keyboard.press("Enter");
await page.locator(".al-promptbar .mention", { hasText: "@Maya" }).waitFor({ timeout: 5000 });
step("@girl resolves to @Maya chip (alias-aware mention)");
await page.screenshot({ path: path.join(SHOTS, "11-alias-mention.png") });

const fatal = errors.filter(
  (e) =>
    !e.includes("favicon") &&
    !e.includes("React DevTools") &&
    !e.includes("A tree hydrated but some attributes"),
);
if (fatal.length) {
  console.log("CONSOLE ERRORS:");
  fatal.forEach((e) => console.log("  " + e));
  process.exitCode = 1;
} else console.log("\nLIBRARY PROBE PASSED");
await browser.close();
