// Slice 2 QA ($0, mock): Gen Space "Video" mode = text-to-video (t2v). Switch
// the toggle, generate, and confirm a real <video> result + the video cost hint.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
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
step("signed in → Gen space (default surface)");

// switch to Video mode → cost hint flips to the video price
await page.getByRole("tab", { name: "Video", exact: true }).click();
await page.waitForTimeout(200);
const cost = await page.getByText(/~\$0\.35/).count();
if (cost < 1) throw new Error("video cost hint (~$0.35) not shown");
step("Video mode selected → cost hint ~$0.35");

// generate a text-to-video clip (no source image needed)
await page.locator('input[aria-label="Describe the shot"]').fill("a paper lantern drifting over a dark river, slow push-in");
await page.getByRole("button", { name: "Generate", exact: true }).click();
step("requested a text-to-video generation");

// a <video> result lands (mock mp4 via the t2v path)
await page.locator(".screen video").first().waitFor({ timeout: 60000 });
const src = await page.locator(".screen video").first().getAttribute("src");
if (!src || !/\/files\/.+\.(mp4|webm|mov)/.test(src)) throw new Error(`unexpected video src: ${src}`);
const playable = await page.locator(".screen video").first().evaluate((v) => new Promise((res) => {
  if (v.readyState >= 1) return res(true);
  v.addEventListener("loadedmetadata", () => res(true), { once: true });
  setTimeout(() => res(v.readyState >= 1), 4000);
}));
if (!playable) throw new Error("t2v clip did not load");
step(`text-to-video produced a playable clip (${src.split("/").pop()})`);

await browser.close();
const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver/.test(e));
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 6).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\nGEN SPACE VIDEO QA PASSED (t2v, mock $0)");
process.exit(0);
