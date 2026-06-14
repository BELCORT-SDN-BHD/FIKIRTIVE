// LOCAL verification of the double-click money-safety fix (GenSpace busyRef guard).
// Mock providers + local DB → $0, no worker needed: the double-spend is about job
// CREATION, so we only assert exactly ONE GenJob row is created from a same-frame
// double-click (the harness Pass 3 caught creating TWO on prod, pre-fix).
// Run:  node scripts/local-doubleclick-verify.mjs
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../packages/db/dist/src/index.js");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();

let passed = false, projectId = null;
try {
  // login (dev magic-link → file)
  await page.goto(BASE + "/login");
  await page.locator('input[type="email"]').fill("tools@belcort.com");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
  await page.goto((await readFile(".data/last-magic-link.txt", "utf8")).trim());
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });

  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("DoubleClick verify");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
  projectId = new URL(page.url()).searchParams.get("p");

  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await editor.click();
  await page.keyboard.type("a quiet harbor at first light, calm water");

  const genBtn = page.getByRole("button", { name: "Generate", exact: true });
  const click = await dbNow();
  await genBtn.evaluate((b) => { b.click(); b.click(); }); // two clicks, ONE synchronous frame

  let ones = 0, twoPlus = 0;
  for (let i = 0; i < 15 && ones < 6; i++) {
    const c = await prisma.genJob.count({ where: { projectId, createdAt: { gte: click } } });
    if (c >= 2) { twoPlus = c; break; }
    ones = c === 1 ? ones + 1 : 0;
    await page.waitForTimeout(1000);
  }
  if (twoPlus >= 2) fail(`FIX FAILED: double-click still created ${twoPlus} jobs`);
  if (ones < 6) fail("no stable single job — did the click register?");
  console.log(`✓ FIX VERIFIED (local): same-frame double-click → exactly 1 GenJob created (no double-spend)`);
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  if (projectId) {
    await prisma.genJob.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.generation.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.actionEvent.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
}
if (!passed) process.exit(1);
console.log("LOCAL DOUBLE-CLICK FIX VERIFIED");
process.exit(0);
