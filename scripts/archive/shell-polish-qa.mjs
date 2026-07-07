// Slice 4 QA ($0): Canvas hidden from nav; topbar Export routes to the editor
// (and is hidden on the editor surface). Also grabs progress screenshots.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = path.join(os.homedir(), ".gstack/projects/artlio/shell-polish");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const step = (m) => console.log(`✓ ${m}`);

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// Canvas gone from the sidebar nav
const navLabels = await page.$$eval(".navitem", (els) => els.map((e) => e.getAttribute("title")));
if (navLabels.includes("Canvas")) throw new Error("Canvas still in nav");
if (!navLabels.includes("Storyboard") || !navLabels.includes("Assets")) throw new Error(`nav missing items: ${navLabels}`);
step(`Canvas hidden — nav: ${navLabels.filter(Boolean).join(", ")}`);

// topbar Export shows off-editor and routes to the editor
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(300);
const exportTop = page.getByRole("button", { name: "Export", exact: true });
if (await exportTop.count() < 1) throw new Error("topbar Export missing off-editor");
await exportTop.click();
await page.waitForTimeout(1500);
if ((await page.getByRole("button", { name: "Export", exact: true }).count()) > 0) throw new Error("topbar Export still visible on editor (duplicate)");
const exportMp4 = await page.getByRole("button", { name: "Export MP4" }).count();
step(`topbar Export → editor; on editor only "Export MP4" remains (${exportMp4} found, no duplicate)`);
await page.screenshot({ path: path.join(OUT, "editor.png") });

// screenshots of the richer surfaces
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, "storyboard.png") });
await page.getByRole("button", { name: "Assets", exact: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, "assets.png") });
step("screenshots saved");

await browser.close();
console.log("\nSHELL POLISH QA PASSED ($0)");
process.exit(0);
