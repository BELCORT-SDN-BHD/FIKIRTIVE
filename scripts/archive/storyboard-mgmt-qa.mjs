// Slice 1a QA ($0, no worker): Storyboard shot management — add, reorder, delete,
// and the cost hint. Drives the real server actions through the UI.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

// order of cards by their saved prompt text
const order = async () => page.$$eval(".al-mediacard textarea", (els) => els.map((e) => e.value));

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
step("signed in");

// fresh project for isolation
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Reorder QA");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
await page.waitForTimeout(600);
step("created project 'Reorder QA'");

await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(400);

// add 3 shots A/B/C (fill + blur so the prompt persists across refresh)
for (const label of ["AAA", "BBB", "CCC"]) {
  await page.getByRole("button", { name: /Add (the first )?shot/ }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".al-mediacard textarea").length === n, ["AAA", "BBB", "CCC"].indexOf(label) + 1, { timeout: 10000 });
  const card = page.locator(".al-mediacard").last();
  await card.locator("textarea").fill(label);
  await card.locator("textarea").blur();
  await page.waitForTimeout(400);
}
let o = await order();
if (o.join(",") !== "AAA,BBB,CCC") throw new Error(`initial order ${o}`);
step(`added 3 shots in order: ${o.join(" → ")}`);

// cost hint present on a shot with no image
const cost = await page.locator(".al-mediacard").first().getByText(/Generate ~\$/).count();
if (cost < 1) throw new Error("cost hint missing");
step("cost hint shown before spend (Generate ~$…)");

// move BBB (card 2) earlier → BBB,AAA,CCC
await page.locator(".al-mediacard").nth(1).getByRole("button", { name: "Move shot earlier" }).click();
await page.waitForFunction(() => document.querySelectorAll(".al-mediacard textarea")[0]?.value === "BBB", null, { timeout: 8000 });
o = await order();
if (o.join(",") !== "BBB,AAA,CCC") throw new Error(`after move-left ${o}`);
step(`moved BBB earlier → ${o.join(" → ")}`);

// delete the middle (AAA) → BBB,CCC
await page.locator(".al-mediacard").nth(1).getByRole("button", { name: "Delete shot" }).click();
await page.waitForFunction(() => document.querySelectorAll(".al-mediacard textarea").length === 2, null, { timeout: 8000 });
o = await order();
if (o.join(",") !== "BBB,CCC") throw new Error(`after delete ${o}`);
step(`deleted AAA → ${o.join(" → ")} (2 shots)`);

// the displayed numbers renumber 1..N (no gap from the delete)
const nums = await page.$$eval(".al-mediacard", (els) => els.map((e) => (e.textContent.match(/▦\s*(\d+)/) || [])[1]).filter(Boolean));
if (nums.join(",") !== "1,2") throw new Error(`display numbers not contiguous: ${nums}`);
step(`display renumbered contiguously: ${nums.join(", ")}`);

await browser.close();
const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver/.test(e));
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 6).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\nSTORYBOARD MGMT QA PASSED (add/reorder/delete/cost, $0)");
process.exit(0);
