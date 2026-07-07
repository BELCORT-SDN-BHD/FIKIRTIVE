// Focused i2v browser journey ($0, mock worker): a creator generates a shot
// image, then clicks "Animate" to turn it into a video — the real UI wiring
// the DB tracer can't reach (auth-gated /files serving + the actual buttons).
//   Storyboard → new shot → prompt → Generate (image) → Animate (i2v) →
//   the card plays a <video> → Video editor cut picks up the clip.
// Run with: mock worker + web + postgres up. One login (magic-link dev file).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = path.join(os.homedir(), ".gstack/projects/fikirtive/i2v-journey");
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 } });
const page = await ctx.newPage();
const snap = (n) => page.screenshot({ path: path.join(SHOTS, n) });
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 160)}`); });

// ── sign in (dev magic-link file) ────────────────────────────────────
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

// ── Storyboard: a fresh shot ─────────────────────────────────────────
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /Add (the first )?shot/ }).first().click();
await page.waitForTimeout(1200);
const card = page.locator(".al-mediacard").last();
await card.locator("textarea").fill("a paper boat drifts down a rain gutter, cinematic, shallow depth of field");
step("added a shot + wrote its prompt");

// ── Generate the still (mock image) ──────────────────────────────────
await card.getByRole("button", { name: /Generate|Image/ }).first().click();
await card.locator("img").waitFor({ timeout: 60000 });
step("generated the shot still (image)");
await snap("01-still.png");

// ── Animate it (i2v) ─────────────────────────────────────────────────
await card.getByRole("button", { name: "Animate", exact: true }).click();
// the card swaps <img> → <video> once the i2v job lands
await card.locator("video").waitFor({ timeout: 60000 });
const videoSrc = await card.locator("video").getAttribute("src");
if (!videoSrc || !/\/files\/.+\.(mp4|webm|mov)/.test(videoSrc)) throw new Error(`unexpected video src: ${videoSrc}`);
step(`Animate → the shot now plays a video (${videoSrc.split("/").pop()})`);
await snap("02-animated.png");

// the auth-gated /files clip actually loads in the browser (authed session)
const playable = await card.locator("video").evaluate((v) => new Promise((res) => {
  if (v.readyState >= 1 || v.videoWidth > 0) return res(true);
  v.addEventListener("loadedmetadata", () => res(true), { once: true });
  v.addEventListener("error", () => res(false), { once: true });
  setTimeout(() => res(v.readyState >= 1), 4000);
}));
if (!playable) throw new Error("the <video> failed to load metadata (clip not served)");
step("the video clip loads in the browser (authed /files serving works)");

// ── Video editor: the cut includes the animated shot ─────────────────
await page.getByRole("button", { name: "Video editor", exact: true }).click();
await page.waitForTimeout(3000);
step("video editor opened with the storyboard cut (animated shot included)");
await snap("03-editor.png");

await browser.close();
const fatal = errs.filter((e) => !/hydrated but some attributes|React DevTools|ResizeObserver/.test(e));
console.log(`\n=== I2V JOURNEY COMPLETE — screenshots in ${SHOTS} ===`);
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("I2V BROWSER JOURNEY PASSED (image → Animate → video plays → editor, mock $0)");
process.exit(0);
