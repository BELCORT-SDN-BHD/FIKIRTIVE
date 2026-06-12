// Fix QA ($0, mock): (1) Gen space — upload a reference image → image-to-video;
// (2) topbar shows the real user (one avatar), not the fake TB/MO stack.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
// a tiny valid PNG to upload as the i2v source
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
step("signed in → Gen space");

// (2) avatar: exactly one avatar in the topbar, not the fake TB/MO pair
const avs = page.locator("header.topbar .al-avatar");
const n = await avs.count();
const txt = (await avs.allTextContents()).map((s) => s.trim());
if (n !== 1) throw new Error(`topbar has ${n} avatars (${txt}), expected 1 (the real user)`);
if (txt[0] === "TB" || txt[0] === "MO") throw new Error(`avatar still a fake collaborator: ${txt[0]}`);
step(`topbar shows one real-user avatar: "${txt[0]}" (no fake TB/MO)`);

// fresh project
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("i2v Upload QA");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
await page.waitForTimeout(500);

// (1) upload a reference image into the composer
await page.locator('.composer-dock input[type="file"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: PNG });
await page.locator('.composer-dock img[alt="reference"]').waitFor({ timeout: 30000 });
step("uploaded a reference image → thumbnail in the composer");

// it should auto-select Video mode and show the i2v hint
await page.getByText("→ image-to-video", { exact: false }).first().waitFor({ timeout: 5000 });
const videoSelected = await page.getByRole("tab", { name: "Video", exact: true }).getAttribute("aria-selected");
if (videoSelected !== "true") throw new Error("uploading a reference did not switch to Video mode");
step("auto-switched to Video (image-to-video) with the reference");

// generate → a video result (i2v from the uploaded still)
await page.locator('input[aria-label="Describe the shot"]').fill("the scene comes alive, gentle camera drift");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await page.locator(".screen video").first().waitFor({ timeout: 60000 });
const src = await page.locator(".screen video").first().getAttribute("src");
if (!src || !/\/files\/.+\.(mp4|webm|mov)/.test(src)) throw new Error(`unexpected video src: ${src}`);
step(`image-to-video produced a clip from the uploaded reference (${src.split("/").pop()})`);

await browser.close();
const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|404|preload/.test(e));
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 6).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\nGEN SPACE i2v-UPLOAD + AVATAR QA PASSED ($0)");
process.exit(0);
