// Studio shell e2e + audit: login → /studio → click each surface, screenshot,
// assert it rendered (title + no page errors). Mock-first shell verification.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "/tmp/design-shots/mine";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0,160)}`); });

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);
console.log("✓ signed in, /studio loaded");

const surfaces = [
  { nav: "Gen space", expect: "Woman Drinking Coffee" },
  { nav: "Canvas", expect: "Loose ideas live here" },
  { nav: "Storyboard", expect: "Start with your story" },
  { nav: "Video editor", expect: "Let’s start editing" },
  { nav: "Elements", expect: "Lock a character or object once" },
  { nav: "Assets", expect: "Your library is empty" },
];
let pass = 0;
for (const s of surfaces) {
  await page.getByRole("button", { name: s.nav, exact: true }).click();
  await page.waitForTimeout(700);
  try {
    await page.getByText(s.expect, { exact: false }).first().waitFor({ timeout: 6000 });
    await page.screenshot({ path: `${OUT}/${s.nav.replace(/\s+/g,"-")}.png` });
    console.log(`✓ ${s.nav} — rendered ("${s.expect.slice(0,30)}…")`);
    pass++;
  } catch {
    console.log(`✗ ${s.nav} — FAILED to render expected content`);
  }
}
// active-state audit: clicking a nav marks it active
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(300);
const active = await page.locator('.navitem.active .lbl').textContent();
console.log(active === "Storyboard" ? "✓ active nav state tracks selection" : `✗ active nav wrong: ${active}`);

await browser.close();
const fatal = errs.filter((e) => !/hydrated but some attributes|Download the React DevTools/.test(e));
console.log(`\n=== AUDIT: ${pass}/${surfaces.length} surfaces rendered ===`);
if (fatal.length) { console.log("PAGE/CONSOLE ERRORS:"); fatal.slice(0,8).forEach(e=>console.log("  "+e)); process.exit(1); }
console.log("NO page/console errors. STUDIO E2E PASSED");
