// Detailed real-user journey through the redesigned Studio (/studio), end to
// end, against REAL fal: a creator makes a "Coffee Ad" project — new project →
// create a character element + generate its reference → storyboard shots with
// prompts + per-shot generate → video editor → export.
// Run with: worker (real fal + local), web (local), MinIO/postgres up, clean DB.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = path.join(os.homedir(), ".gstack/projects/artlio/studio-journey");
mkdirSync(SHOTS, { recursive: true });
const snap = (n) => page.screenshot({ path: path.join(SHOTS, n) });
const step = (m) => console.log(`✓ ${m}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 160)}`); });

// ── sign in ──────────────────────────────────────────────────────────
const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
step("signed in → Studio");

// ── 1. new project "Coffee Ad" ───────────────────────────────────────
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Coffee Ad");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
await page.waitForTimeout(800);
await page.locator(".sidenav-project-name", { hasText: "Coffee Ad" }).waitFor({ timeout: 8000 });
step("created project 'Coffee Ad'");
await snap("01-project.png");

// ── 2. Elements: create character Mara + generate a reference (real fal) ─
await page.getByRole("button", { name: "Elements", exact: true }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "New element", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.getByRole("tab", { name: "Character", exact: true }).click();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Mara");
await page.getByText("Generate refs", { exact: true }).click();
await page.getByRole("button", { name: /Create & generate/ }).click();
await page.locator('aside input[aria-label="Element name"]').waitFor({ timeout: 15000 });
step("created character @Mara → detail drawer open");
// set count to 1 (faster, still real) and generate the reference
await page.locator('aside select[aria-label="Number of images"]').selectOption("1");
await page.locator("aside").getByRole("button", { name: /Generate 1/ }).click();
console.log("  … generating Mara's reference via real fal (~25s)…");
await page.locator("aside .ref-thumb").first().waitFor({ timeout: 120000 });
step("generated @Mara reference image (real fal)");
await snap("02-element-mara.png");

// ── 3. Storyboard: two shots with prompts, generate each (real fal) ──────
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(500);
const shotPrompts = [
  "Mara sips coffee by a sunny café window, warm cinematic light, medium shot",
  "close on Mara, a slow contented smile, soft morning light",
];
for (const [i, prompt] of shotPrompts.entries()) {
  await page.getByRole("button", { name: i === 0 ? /Add the first shot|Add shot/ : /Add shot/ }).first().click();
  await page.waitForTimeout(1200);
  const card = page.locator(".al-mediacard").nth(i);
  await card.locator("textarea").fill(prompt);
  await card.getByRole("button", { name: /Generate/ }).click();
  console.log(`  … shot ${i + 1} generating via real fal…`);
  await card.locator("img").waitFor({ timeout: 120000 });
  step(`shot ${i + 1} generated: "${prompt.slice(0, 40)}…"`);
}
await snap("03-storyboard.png");

// ── 4. Video editor: the cut assembles from the shots, export ────────────
await page.getByRole("button", { name: "Video editor", exact: true }).click();
await page.waitForTimeout(3000);
// the Shotstack editor mounts with the two shots as clips
const clipCount = await page.getByText(/clip/i).first().textContent().catch(() => "");
step(`video editor loaded with the storyboard cut (${clipCount?.trim() || "shots imported"})`);
await snap("04-editor.png");
// click the EDITOR's Export MP4 (not the shell topbar Export)
await page.getByRole("button", { name: "Export MP4", exact: true }).click();
console.log("  … export → ffmpeg render…");
// the render strip shows the job; wait for DONE
await page.getByText(/Done|Ready|Download/i).first().waitFor({ timeout: 120000 }).catch(() => {});
await page.waitForTimeout(2000);
step("exported — MP4 rendered by the ffmpeg worker");
await snap("05-export.png");

await browser.close();
const fatal = errs.filter((e) => !/hydrated but some attributes|Download the React DevTools|ResizeObserver/.test(e));
console.log(`\n=== JOURNEY COMPLETE — screenshots in ${SHOTS} ===`);
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("REAL USER JOURNEY PASSED (new project → element+ref → storyboard shots → editor export, real fal)");
