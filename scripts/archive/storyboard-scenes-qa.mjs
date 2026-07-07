// Slice 1b QA ($0): multi-scene storyboard — scene groups, per-scene add,
// within-scene numbering, and reorder bounded to a scene.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

const sectionCardCounts = () =>
  page.$$eval("section", (secs) => secs.map((s) => s.querySelectorAll(".al-mediacard").length));
const sceneNums = (si) =>
  page.$$eval(`section:nth-of-type(${si + 1}) .al-mediacard`, (els) =>
    els.map((e) => (e.textContent.match(/▦\s*(\d+)/) || [])[1]).filter(Boolean));

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
step("signed in");

await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Scenes QA");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(500);

// scene 1: two shots (top "Add shot" targets the last scene)
for (let i = 0; i < 2; i++) {
  await page.getByRole("button", { name: /Add (the first )?shot/ }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".al-mediacard").length === n, i + 1, { timeout: 10000 });
}
step("scene 1: added 2 shots");

// add a second scene (creates scene 2 with its first shot)
await page.getByRole("button", { name: "Add scene", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll("section").length === 2, null, { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll(".al-mediacard").length === 3, null, { timeout: 10000 });
step("added Scene 2 (with its first shot)");

// add one more shot into scene 2 via its own drop-zone
await page.getByRole("button", { name: "Add shot to scene 2" }).click();
await page.waitForFunction(() => document.querySelectorAll(".al-mediacard").length === 4, null, { timeout: 10000 });

const counts = await sectionCardCounts();
if (counts.join(",") !== "2,2") throw new Error(`scene card counts ${counts}, expected 2,2`);
step(`two scenes, 2 shots each (counts ${counts.join(" / ")})`);

// within-scene numbering: each scene starts at 1
const s1 = await sceneNums(0), s2 = await sceneNums(1);
if (s1.join(",") !== "1,2" || s2.join(",") !== "1,2") throw new Error(`scene numbering s1=${s1} s2=${s2}`);
step(`within-scene numbering resets per scene (S1 ${s1.join(",")} · S2 ${s2.join(",")})`);

// reorder inside scene 2 stays in scene 2 (counts unchanged)
await page.locator("section:nth-of-type(2) .al-mediacard").nth(1).getByRole("button", { name: "Move shot earlier" }).click();
await page.waitForTimeout(1500);
const after = await sectionCardCounts();
if (after.join(",") !== "2,2") throw new Error(`reorder crossed a scene boundary: ${after}`);
step("reorder stays within its scene (counts still 2 / 2)");

await browser.close();
const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver/.test(e));
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 6).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\nSTORYBOARD SCENES QA PASSED ($0)");
process.exit(0);
