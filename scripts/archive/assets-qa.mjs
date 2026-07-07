// Slice 3 QA ($0, mock): Assets media library — a generated candidate shows up,
// filters work, it attaches to a shot, and it deletes.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
const cardCount = () => page.locator(".al-mediacard").count();

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });

// fresh project so the library starts empty
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Assets QA");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
await page.waitForTimeout(500);
step("created project 'Assets QA'");

// Gen space (default surface): generate one candidate image (mock)
await page.locator('input[aria-label="Describe the shot"]').fill("a brass compass on a worn map");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await page.locator(".screen img").first().waitFor({ timeout: 60000 });
step("generated a candidate image in Gen space");

// a shot to attach into
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.getByRole("button", { name: /Add (the first )?shot/ }).first().click();
await page.waitForFunction(() => document.querySelectorAll(".al-mediacard").length >= 1, null, { timeout: 8000 });
step("added a shot");

// Assets: the candidate is in the library
await page.getByRole("button", { name: "Assets", exact: true }).click();
await page.waitForTimeout(600);
if (await cardCount() < 1) throw new Error("candidate not shown in Assets");
const badge = await page.locator(".al-mediacard").first().getByText(/Candidate|In a shot/).first().textContent();
step(`library shows the media (badge: "${badge?.trim()}")`);

// filter: Videos hides the image; Images shows it
await page.getByRole("tab", { name: "Videos", exact: true }).click();
await page.waitForTimeout(300);
if (await cardCount() !== 0) throw new Error("Videos filter should hide the image");
await page.getByRole("tab", { name: "Images", exact: true }).click();
await page.waitForTimeout(300);
if (await cardCount() < 1) throw new Error("Images filter should show the image");
step("filters work (Videos hides, Images shows)");

// attach the candidate to the shot
await page.getByRole("tab", { name: "All", exact: true }).click();
await page.locator(".al-mediacard select[aria-label='Add to shot']").first().selectOption({ index: 1 });
await page.waitForFunction(() => {
  const c = document.querySelector(".al-mediacard");
  return c && /In a shot/.test(c.textContent || "");
}, null, { timeout: 8000 });
step("attached the candidate to a shot (badge → In a shot)");

// delete it → empty
const before = await cardCount();
await page.locator(".al-mediacard").first().getByRole("button", { name: "Delete asset" }).click();
await page.waitForFunction((n) => document.querySelectorAll(".al-mediacard").length === n - 1, before, { timeout: 8000 });
step("deleted the asset (removed from the library)");

await browser.close();
const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver/.test(e));
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 6).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\nASSETS QA PASSED (browse/filter/attach/delete, $0)");
process.exit(0);
